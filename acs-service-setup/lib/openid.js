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
        // Empty string disables theme override and lets Keycloak fall
        // back to its built-in keycloak.v2 theme.
        this.login_theme = process.env.OPENID_LOGIN_THEME ?? "";
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
            // F+ identities are username+Kerberos. We don't issue email
            // addresses and the federation provider has no email field
            // to query, so accepting "username or email" misleads users
            // into trying their personal email. Force username-only.
            loginWithEmailAllowed: false,
            registrationAllowed: false,
            sslRequired: this.acs.secure ? "external" : "none",
        };
        // Login pages are the visible surface (sign in, logout, error).
        // The account console isn't reskinned - users don't reach it in
        // ACS - so we only override loginTheme. Always assign the field
        // (even when empty) so flipping the values.yaml setting back
        // off actually propagates instead of being shadowed by the
        // existing realm value during the merge below.
        desired.loginTheme = this.login_theme;
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

        // Keycloak component records use the realm's internal UUID as
        // parentId, NOT the realm name. Passing the name leaves the
        // component orphaned: it persists but never shows up under the
        // realm in the UI or via filtered lookups, so subsequent runs
        // can't find it to update and the create silently piles up
        // duplicates. Resolve the UUID first.
        const realmRes = await this.api("GET",
            `/admin/realms/${encodeURIComponent(this.realm)}`);
        const realmUuid = realmRes.body?.id;
        if (!realmUuid) {
            throw new Error(`Cannot resolve realm UUID for ${this.realm}`);
        }

        const path = `/admin/realms/${encodeURIComponent(this.realm)}/components`;
        const list = await this.api("GET",
            `${path}?type=org.keycloak.storage.UserStorageProvider&parent=${encodeURIComponent(realmUuid)}`);
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
            parentId: realmUuid,
            config: {
                "auth.url":             [this.auth_internal_url],
                "auth.timeout.seconds": ["5"],
                "cache.ttl.seconds":    ["60"],
                // The openid Pod mounts krb5-keytabs at /etc/keytabs
                // and remaps the sv1openid secret key to filename
                // `client` (see deploy/templates/openid/openid.yaml
                // volume items). Don't change this path without
                // updating the volume mapping there.
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
        // Each of these has an auto-derived default keyed off `root`
        // (i.e. `<proto>://<name>.<acs.baseUrl>`) which is right for
        // any application served at that canonical host. Apps served
        // elsewhere - external domains, partner integrations, multiple
        // environments behind one realm - declare the corresponding
        // field in values.yaml to replace the default. Keycloak's
        // post.logout.redirect.uris attribute is a single string with
        // entries joined by `##`.
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
            rootUrl: spec.rootUrl ?? root,
            baseUrl: spec.baseUrl ?? root,
            redirectUris: spec.redirectUris
                ?? [`${root}${spec.redirectPath ?? "/*"}`],
            webOrigins: spec.webOrigins ?? [root],
            attributes: {
                "post.logout.redirect.uris":
                    (spec.postLogoutRedirectUris ?? [root]).join("##"),
                // When an admin force-logs-out a user in Keycloak,
                // backchannel.logout.session.required tells Keycloak to
                // POST a session-end notification to the client so it
                // can drop its local session instead of holding a stale
                // one until the next refresh attempt. Picked up from
                // upstream PR #443.
                "backchannel.logout.session.required": "true",
            },
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

    /** Stamp the Factory+ identity claims (fp_principal_uuid,
     *  fp_permissions) into every token issued for this OIDC client.
     *  Both mappers are shipped by the acs-keycloak-spi jar and
     *  registered via
     *  META-INF/services/org.keycloak.protocol.ProtocolMapper.
     *
     *  Idempotent: existing mappers are updated to the canonical
     *  config (so renames or schema fixes propagate on helm upgrade). */
    async ensure_factoryplus_claim_mappers (clientUuid) {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}`
            + `/clients/${clientUuid}/protocol-mappers/models`;
        const list = await this.api("GET", path);

        const mappers = [
            { name: "fp_principal_uuid",
              protocolMapper: "factoryplus-principal-uuid-mapper",
              multivalued: false },
            { name: "fp_permissions",
              protocolMapper: "factoryplus-permissions-mapper",
              // fp_permissions is a list of permission UUIDs; without
              // multivalued=true OIDCAttributeMapperHelper.mapClaim
              // collapses it to the first element and breaks JMESPath
              // like contains(fp_permissions[*], '<uuid>').
              multivalued: true },
        ];
        const byName = new Map(
            (list.body ?? []).map(m => [m.name, m]));
        for (const m of mappers) {
            const config = {
                "id.token.claim":       "true",
                "access.token.claim":   "true",
                "userinfo.token.claim": "true",
                "introspection.token.claim": "true",
                "multivalued":          String(m.multivalued),
            };
            const existing = byName.get(m.name);
            if (existing) {
                this.log("Updating %s mapper on client %s", m.name, clientUuid);
                await this.api("PUT", `${path}/${existing.id}`, {
                    ...existing,
                    protocol: "openid-connect",
                    protocolMapper: m.protocolMapper,
                    config,
                });
            } else {
                this.log("Creating %s mapper on client %s", m.name, clientUuid);
                await this.api("POST", path, {
                    name: m.name,
                    protocol: "openid-connect",
                    protocolMapper: m.protocolMapper,
                    config,
                });
            }
        }
    }

    /** Disable required actions that try to write back to the federated
     *  user. F+ has no email/firstName/lastName fields, and our SPI
     *  adapter is read-only - if Keycloak prompts the user to fill in
     *  those fields and tries to save them, the save fails with
     *  ReadOnlyException. Disable the actions globally for the realm. */
    async ensure_required_actions_disabled () {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}/authentication/required-actions`;
        const res = await this.api("GET", path);
        const blockers = ["UPDATE_PROFILE", "VERIFY_PROFILE", "VERIFY_EMAIL"];
        for (const ra of res.body ?? []) {
            if (!blockers.includes(ra.alias) || !ra.enabled) continue;
            this.log("Disabling required action %s", ra.alias);
            await this.api("PUT", `${path}/${ra.alias}`,
                { ...ra, enabled: false, defaultAction: false });
        }
    }

    async run () {
        await this.wait_for_ready();
        await this.ensure_realm();
        await this.ensure_factoryplus_federation();
        await this.ensure_required_actions_disabled();

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
