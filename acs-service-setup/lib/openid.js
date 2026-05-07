/* ACS service setup
 * Keycloak realm/client/user provisioning
 * Copyright 2026 University of Sheffield AMRC
 */

import fs from "node:fs/promises";
import timers from "node:timers/promises";

const SECRET_DIR = "/etc/secret";
const READY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_POLL_MS = 5 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 10 * 1000;

class OpenIDSetup {
    constructor (ss) {
        const { fplus } = ss;
        this.log = fplus.debug.bound("openid");
        this.config = ss.config;
        this.acs = ss.acs_config;

        this.url = process.env.OPENID_URL.replace(/\/+$/, "");
        this.realm = process.env.OPENID_REALM;
        this.kerberos_realm = this.acs.realm;
        // Cluster-internal F+ auth URL (e.g.
        // http://auth.factory-plus.svc.cluster.local). The Keycloak
        // SPI federation calls this URL for principal/group lookups.
        this.auth_internal_url = (process.env.AUTH_INTERNAL_URL ?? "")
            .replace(/\/+$/, "");

        this.token = null;
        this.token_expires_at = 0;
    }

    async read_secret (name) {
        return (await fs.readFile(`${SECRET_DIR}/${name}`, "utf8")).trim();
    }

    async wait_for_ready () {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        const url = `${this.url}/realms/master/.well-known/openid-configuration`;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(url);
                if (res.ok) {
                    this.log("Keycloak is ready");
                    return;
                }
                this.log("Keycloak not ready (HTTP %d), waiting", res.status);
            }
            catch (e) {
                this.log("Keycloak not ready (%s), waiting", e.message);
            }
            await timers.setTimeout(READY_POLL_MS);
        }
        throw new Error(`Keycloak did not become ready within ${READY_TIMEOUT_MS}ms`);
    }

    async get_token () {
        if (this.token && Date.now() < this.token_expires_at - TOKEN_REFRESH_BUFFER_MS)
            return this.token;

        const password = await this.read_secret("_bootstrap");
        const body = new URLSearchParams({
            grant_type: "password",
            client_id: "admin-cli",
            username: "_bootstrap",
            password,
        });
        const res = await fetch(`${this.url}/realms/master/protocol/openid-connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        if (!res.ok)
            throw new Error(`Failed to acquire admin token: ${res.status} ${await res.text()}`);
        const data = await res.json();
        this.token = data.access_token;
        this.token_expires_at = Date.now() + (data.expires_in * 1000);
        return this.token;
    }

    async api (method, path, body) {
        const token = await this.get_token();
        const opts = {
            method,
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
            },
        };
        if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(`${this.url}${path}`, opts);
        if (!res.ok && res.status !== 404 && res.status !== 409) {
            const text = await res.text();
            throw new Error(`Keycloak ${method} ${path} -> ${res.status}: ${text}`);
        }
        const len = res.headers.get("content-length");
        const ctype = res.headers.get("content-type") ?? "";
        const json = ctype.includes("application/json") && len !== "0"
            ? await res.json().catch(() => null)
            : null;
        return { status: res.status, body: json, location: res.headers.get("location") };
    }

    async ensure_realm () {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}`;
        const get = await this.api("GET", path);
        const desired = {
            realm: this.realm,
            enabled: true,
            loginWithEmailAllowed: true,
            registrationAllowed: false,
            sslRequired: this.acs.secure ? "external" : "none",
        };
        if (get.status === 404) {
            this.log("Creating realm %s", this.realm);
            await this.api("POST", "/admin/realms", desired);
        }
        else {
            this.log("Updating realm %s", this.realm);
            await this.api("PUT", path, { ...get.body, ...desired });
        }
    }

    /** Provision the Factory+ User Storage SPI as Keycloak's federation
     *  source. Replaces the previous Kerberos federation. Idempotent:
     *  on a redeploy the existing component is updated in-place; if the
     *  legacy `kerberos` provider is still present it's removed.
     */
    async ensure_factoryplus_federation () {
        if (!this.auth_internal_url) {
            throw new Error("AUTH_INTERNAL_URL must be set so the SPI "
                + "federation can reach the F+ auth service");
        }

        const path = `/admin/realms/${encodeURIComponent(this.realm)}/components`;
        const list = await this.api("GET",
            `${path}?type=org.keycloak.storage.UserStorageProvider&parent=${encodeURIComponent(this.realm)}`);
        const existing = (list.body ?? []).find(c => c.providerId === "factoryplus");
        const oldKrb   = (list.body ?? []).find(c => c.providerId === "kerberos");

        if (oldKrb) {
            this.log("Removing legacy Kerberos federation provider");
            await this.api("DELETE", `${path}/${oldKrb.id}`);
        }

        const sv1openid = `sv1openid@${this.kerberos_realm}`;

        const desired = {
            name: "factoryplus",
            providerId: "factoryplus",
            providerType: "org.keycloak.storage.UserStorageProvider",
            parentId: this.realm,
            config: {
                "auth.url":             [this.auth_internal_url],
                "auth.timeout.seconds": ["5"],
                "cache.ttl.seconds":    ["60"],
                // Path matches the keytab mount in
                // deploy/templates/openid/openid.yaml. Principal must
                // exist in the cluster's KDC and have the keytab
                // available at this path inside the Keycloak pod.
                "auth.principal":   [sv1openid],
                "auth.keytab.path": ["/etc/keytabs/client"],
            },
        };

        if (existing) {
            this.log("Updating Factory+ federation provider");
            await this.api("PUT", `${path}/${existing.id}`,
                { ...existing, ...desired });
            return existing.id;
        }
        this.log("Creating Factory+ federation provider -> %s as %s",
            this.auth_internal_url, sv1openid);
        const created = await this.api("POST", path, desired);
        return created.location?.split("/").pop();
    }

    async find_client (clientId) {
        const res = await this.api("GET",
            `/admin/realms/${encodeURIComponent(this.realm)}/clients?clientId=${encodeURIComponent(clientId)}`);
        return (res.body ?? [])[0];
    }

    redirect_root (name) {
        return `${this.acs.secure ? "https" : "http"}://${name}.${this.acs.domain}`;
    }

    async ensure_client (name, spec) {
        const root = this.redirect_root(name);
        const secret = await this.read_secret(name);
        const desired = {
            clientId: name,
            name: spec.name ?? name,
            enabled: true,
            protocol: "openid-connect",
            publicClient: false,
            standardFlowEnabled: true,
            directAccessGrantsEnabled: false,
            serviceAccountsEnabled: false,
            secret,
            rootUrl: root,
            baseUrl: root,
            redirectUris: [`${root}${spec.redirectPath ?? "/*"}`],
            webOrigins: [root],
            attributes: { "post.logout.redirect.uris": root },
        };

        let client = await this.find_client(name);
        if (!client) {
            this.log("Creating client %s", name);
            await this.api("POST", `/admin/realms/${encodeURIComponent(this.realm)}/clients`, desired);
            client = await this.find_client(name);
        }
        else {
            this.log("Updating client %s", name);
            await this.api("PUT",
                `/admin/realms/${encodeURIComponent(this.realm)}/clients/${client.id}`,
                { ...client, ...desired });
        }
        return client;
    }

    /** Stamp the Factory+ identity claims (fp_principal_uuid, fp_groups)
     *  into every token issued for this OIDC client. Both mappers are
     *  shipped by the acs-keycloak-spi jar and registered via
     *  META-INF/services/org.keycloak.protocol.ProtocolMapper.
     *
     *  Existing mappers with the same name are not modified; this is
     *  safe to run on every helm upgrade. */
    async ensure_factoryplus_claim_mappers (clientUuid) {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}`
            + `/clients/${clientUuid}/protocol-mappers/models`;
        const list = await this.api("GET", path);
        const present = new Set((list.body ?? []).map(m => m.name));

        const mappers = [
            { name: "fp_principal_uuid",
              protocolMapper: "factoryplus-principal-uuid-mapper" },
            { name: "fp_groups",
              protocolMapper: "factoryplus-groups-mapper" },
        ];
        for (const m of mappers) {
            if (present.has(m.name)) continue;
            this.log("Creating %s mapper on client %s", m.name, clientUuid);
            await this.api("POST", path, {
                name: m.name,
                protocol: "openid-connect",
                protocolMapper: m.protocolMapper,
                config: {
                    "id.token.claim":       "true",
                    "access.token.claim":   "true",
                    "userinfo.token.claim": "true",
                    "introspection.token.claim": "true",
                },
            });
        }
    }

    async run () {
        await this.wait_for_ready();
        await this.ensure_realm();
        await this.ensure_factoryplus_federation();

        const clients = this.config.openidClients ?? {};
        for (const [name, spec] of Object.entries(clients)) {
            if (!spec.enabled) continue;

            let clientUuid;
            if (spec.builtin) {
                const existing = await this.find_client(name);
                if (!existing) {
                    this.log("Builtin client %s not found, skipping", name);
                    continue;
                }
                clientUuid = existing.id;
            }
            else {
                const client = await this.ensure_client(name, spec);
                clientUuid = client.id;
            }

            // Every OIDC client gets the F+ identity claims so JWT
            // consumers (Grafana, acs-i3x, future shims) read F+ data
            // directly from the token.
            await this.ensure_factoryplus_claim_mappers(clientUuid);
        }

        this.log("OpenID setup complete");
    }
}

export async function setup_openid (ss) {
    const setup = new OpenIDSetup(ss);
    await setup.run();
}
