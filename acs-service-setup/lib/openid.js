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

    async ensure_kerberos_federation () {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}/components`;
        const list = await this.api("GET",
            `${path}?type=org.keycloak.storage.UserStorageProvider&parent=${encodeURIComponent(this.realm)}`);
        const existing = (list.body ?? []).find(c => c.providerId === "kerberos");

        const server_principal = `HTTP/openid.${this.acs.domain}@${this.kerberos_realm}`;
        const desired = {
            name: "kerberos",
            providerId: "kerberos",
            providerType: "org.keycloak.storage.UserStorageProvider",
            parentId: this.realm,
            config: {
                priority: ["0"],
                enabled: ["true"],
                cachePolicy: ["DEFAULT"],
                kerberosRealm: [this.kerberos_realm],
                serverPrincipal: [server_principal],
                keyTab: ["/etc/keytabs/server"],
                debug: ["false"],
                allowPasswordAuthentication: ["true"],
                editMode: ["READ_ONLY"],
                updateProfileFirstLogin: ["true"],
            },
        };

        if (existing) {
            this.log("Updating Kerberos federation provider");
            await this.api("PUT", `${path}/${existing.id}`, { ...existing, ...desired });
            return existing.id;
        }
        this.log("Creating Kerberos federation provider for %s", server_principal);
        const created = await this.api("POST", path, desired);
        return created.location?.split("/").pop();
    }

    async find_client (clientId) {
        const res = await this.api("GET",
            `/admin/realms/${encodeURIComponent(this.realm)}/clients?clientId=${encodeURIComponent(clientId)}`);
        return (res.body ?? [])[0];
    }

    async find_client_role (uuid, name) {
        const res = await this.api("GET",
            `/admin/realms/${encodeURIComponent(this.realm)}/clients/${uuid}/roles/${encodeURIComponent(name)}`);
        return res.status === 404 ? null : res.body;
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

    async ensure_client_roles (uuid, roles) {
        for (const role of roles ?? []) {
            const existing = await this.find_client_role(uuid, role.name);
            if (existing) continue;
            this.log("Creating role %s on client %s", role.name, uuid);
            await this.api("POST",
                `/admin/realms/${encodeURIComponent(this.realm)}/clients/${uuid}/roles`,
                { name: role.name, description: role.description ?? "" });
        }
    }

    async ensure_role_mapper (uuid, clientId) {
        const path = `/admin/realms/${encodeURIComponent(this.realm)}/clients/${uuid}/protocol-mappers/models`;
        const list = await this.api("GET", path);
        const name = "roles-mapper";
        if ((list.body ?? []).some(m => m.name === name)) return;
        this.log("Creating roles protocol mapper on client %s", clientId);
        await this.api("POST", path, {
            name,
            protocol: "openid-connect",
            protocolMapper: "oidc-usermodel-client-role-mapper",
            config: {
                "usermodel.clientRoleMapping.clientId": clientId,
                "claim.name": "roles",
                "jsonType.label": "String",
                "id.token.claim": "true",
                "access.token.claim": "true",
                "userinfo.token.claim": "true",
                "multivalued": "true",
            },
        });
    }

    async ensure_admin_user () {
        const username = `admin@${this.kerberos_realm}`;
        const path = `/admin/realms/${encodeURIComponent(this.realm)}/users`;
        const search = await this.api("GET",
            `${path}?username=${encodeURIComponent(username)}&exact=true`);
        let user = (search.body ?? [])[0];
        if (!user) {
            this.log("Creating admin user %s", username);
            await this.api("POST", path, {
                username,
                enabled: true,
                emailVerified: true,
                email: username,
            });
            const re = await this.api("GET",
                `${path}?username=${encodeURIComponent(username)}&exact=true`);
            user = (re.body ?? [])[0];
            if (!user) throw new Error(`Created admin user but could not find it back`);
        }
        return user;
    }

    async assign_admin_client_roles (userId, clientUuid, role_names) {
        if (!role_names?.length) return;
        const realm_path = `/admin/realms/${encodeURIComponent(this.realm)}`;
        const available = await this.api("GET",
            `${realm_path}/users/${userId}/role-mappings/clients/${clientUuid}/available`);
        const wanted = (available.body ?? []).filter(r => role_names.includes(r.name));
        if (!wanted.length) return;
        await this.api("POST",
            `${realm_path}/users/${userId}/role-mappings/clients/${clientUuid}`,
            wanted);
    }

    async run () {
        await this.wait_for_ready();
        await this.ensure_realm();
        await this.ensure_kerberos_federation();

        const admin = await this.ensure_admin_user();

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
                await this.ensure_client_roles(clientUuid, spec.roles);
                await this.ensure_role_mapper(clientUuid, name);
            }

            await this.assign_admin_client_roles(admin.id, clientUuid, spec.adminRoles);
        }

        this.log("OpenID setup complete");
    }
}

export async function setup_openid (ss) {
    const setup = new OpenIDSetup(ss);
    await setup.run();
}
