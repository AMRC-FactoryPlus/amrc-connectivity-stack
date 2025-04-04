import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { URLSearchParams } from "url";
import { setTimeout } from "timers/promises";

/**
 * Create the startup OpenID realm `factory_plus`.
 *
 * @async
 * @param {ServiceSetup} service_setup - Contains the configuration for setting up the realm.
 * @returns {Promise<void>} Resolves when the realm creation process finishes.
 */
export async function create_openid_realm(service_setup) {
  await new RealmSetup(service_setup).run();
}

class FetchError extends Error {
  constructor (status, msg) {
    super(`Fetch error: ${status}: ${msg}`);
    this.status = status;
  }

  /** Construct and throw a FetchError.
   * @async
   * @arg response A Fetch Response object
   */
  static async throwOf (response) {
    const msg = await response.text();
    throw new this(response.status, msg);
  }

  /** Swallow expected errors.
   * This is intended to be used with Promise.catch. The function
   * returned will rethrow unexpected errors and return undefined for
   * expected errors.
   * @arg codes Expected error status codes
   * @returns A catch function
   */
  static expect (...codes) {
    return err => {
      if (!(err instanceof this))
        throw err;
      if (!codes.includes(err.status))
        throw err;
      return;
    };
  }
}

class RealmSetup {
  constructor(service_setup) {
    const { fplus } = service_setup;
    this.log = fplus.debug.bound("oauth");

    this.fplus = fplus;
    this.username = "_bootstrap";
    this.realm = "factory_plus";
    this.base_url = service_setup.acs_config.domain;
    this.secure = service_setup.acs_config.secure;
    this.acs_realm = service_setup.acs_config.realm;
    this.config = service_setup.config;
  }

  /** Generate a URL to the OpenID server.
   * @param {string} path - The path for the URL
   * @returns {string} A full URL
   */
  url (path) {
    return `http${this.secure}://openid.${this.base_url}/${path}`;
  }

  /** Perform a fetch with error handling.
   * 5xx errors will delay and retry.
   * Other HTTP errors will throw a FetchError.
   * @async
   * @arg request - Request object
   * @returns {Response} A Fetch Response
   */
  async try_fetch (request) {
    const response = await fetch(request);

    if (response.ok)
      return response;

    if (response.status >= 500 && response.status < 600) {
      await setTimeout(10000);
      this.log("Retrying %s", request.url);
      return this.try_fetch(new Request(request));
    }

    await FetchError.throwOf(response);
  }

  /** Fetch a token.
   * @async
   * @arg realm - The realm name.
   * @arg params - An object of parameters for the token request.
   */
  async fetch_token (realm, params) {
    const token_url = this.url(`realms/${realm}/protocol/openid-connect/token`);

    this.log("Token request [%s]: %s", params.grant_type, token_url);

    const response = await this.try_fetch(new Request(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    }));

    return response.json();
}
      
  /** Make a request with a token.
   * 5xx errors will delay and retry.
   * If we get a 401 we retry, once, with a new token.
   * Other HTTP errors will throw.
   * The token method is called on `this`.
   * The Request object will be modified with the token header.
   * @arg tokensrc - Async function to get a token.
   * @arg request - Request object
   * @returns A Response
   */
  async with_token (tokensrc, request, retry) {
    const token = await tokensrc.call(this, retry);

    request.headers.set("Authorization", `Bearer ${token}`);
    const doit = this.try_fetch(request);
    const response = await (retry ? doit : doit.catch(FetchError.expect(401)));

    if (!response)
      return this.with_token(tokensrc, request, true);
      
    return response;
  }

  /** Create an OpenID resouce.
   * Performs a request with the appropriate token.
   * Success returns true. 409 returns false. Other errors throw.
   * @arg opts Options for creation
   * @returns Did we create the resource?
   */
  async openid_create (opts) {
    const url = this.url(opts.path);
    this.log("Attempting to create %s at %s", opts.name, url);

    const request = new Request(url, {
      method:   opts.method,
      headers:  { "Content-Type": "application/json" },
      body:     JSON.stringify(opts.body),
    });

    const created = await this.with_token(opts.tokensrc, request)
      .catch(FetchError.expect(409));

    if (created)
      this.log("Created %s: %o", opts.name, opts.body);
    else
      this.log("Can't create %s: already exists", opts.name);

    return !!created;
  }

  async client_secret (name) {
    const secret_path = path.join("/etc/secret", name);
    const content = await fs.readFile(secret_path, "utf8");
    return content.trim();
  }

  /**
   * Run setup for the realm. This generates the full realm representation.
   *
   * A basic realm is created first and then populated with clients.
   *
   * @async
   * @returns {Promise<void>}
   */
  async run() {
    this.password = await this.client_secret("_bootstrap");
    this.admin_cli_secret = await this.client_secret("_admin");

    await this.create_basic_realm();
    this.admin_user_id = await this.create_admin_user();

    const client_configs = Object.entries(this.config.openidClients);
    const enabled_clients = client_configs.filter(
      ([name, client]) => client.enabled === true,
    );
    for (const [clientId, client] of enabled_clients) {
      if (!client.builtin)
        await this.create_client(clientId, client);
      await this.create_client_role_mappings(clientId, client.adminRoles);
    }
  }

  /**
   * Create a new realm by POSTing to the OpenID service. Throws if the response is not ok.
   *
   * @async
   * @param {Object} realm_representation - An object containing all the values that should be created for the realm.
   * @returns {Promise<void>} Resolves when the realm is created.
   */
  async create_basic_realm() {
    const admin_cli_id = crypto.randomUUID();

    const base_realm = {
      id: crypto.randomUUID(),
      realm: this.realm,
      displayName: "Factory+",
      displayNameHtml: '<div class="kc-logo-text"><span>Factory+</span></div>',
      enabled: true,
      components: {
        "org.keycloak.storage.UserStorageProvider": [
          {
            id: crypto.randomUUID(),
            name: "Kerberos",
            providerId: "kerberos",
            subComponents: {},
            config: {
              serverPrincipal: [
                `HTTP/openid.${this.base_url}@${this.acs_realm}`,
              ],
              allowPasswordAuthentication: ["true"],
              debug: ["true"],
              keyTab: ["/etc/keytabs/server"],
              cachePolicy: ["DEFAULT"],
              updateProfileFirstLogin: ["true"],
              kerberosRealm: [this.acs_realm],
              enabled: ["true"],
            },
          },
        ],
      },
      clients: [
        {
          id: admin_cli_id,
          clientId: "admin-cli",
          name: "Admin service account",
          enabled: true,
          clientAuthenticatorType: "client-secret",
          secret: this.admin_cli_secret,
          directAccessGrantsEnabled: true,
          serviceAccountsEnabled: true,
          authorizationServicesEnabled: true,
        },
      ],
      roles: {
        client: {
          "admin-cli": [
            {
              id: crypto.randomUUID(),
              name: "manage-users",
              description: "",
              composite: false,
              clientRole: true,
              containerId: admin_cli_id,
              attributes: {},
            },
            {
              id: crypto.randomUUID(),
              name: "uma_protection",
              composite: false,
              clientRole: true,
              containerId: admin_cli_id,
              attributes: {},
            },
            {
              id: crypto.randomUUID(),
              name: "manage-realm",
              description: "",
              composite: false,
              clientRole: true,
              containerId: admin_cli_id,
              attributes: {},
            },
          ],
        },
      },
      users: [
        {
          id: crypto.randomUUID(),
          username: "service-account-admin-cli",
          emailVerified: false,
          enabled: true,
          serviceAccountClientId: "admin-cli",
          realmRoles: ["default-roles-factory_plus"],
          clientRoles: {
            "realm-management": ["manage-realm", "manage-users"],
            "admin-cli": ["uma_protection"],
          },
        },
      ],
    };

    await this.openid_create({
      name:     `realm`,
      tokensrc: this.get_initial_access_token,
      method:   "POST",
      path:     `admin/realms`,
      body:     base_realm,
    });
  }

  /**
   * Create a new client by POSTing to the OpenID service. Throws if the response is not ok.
   *
   * @async
   * @param {Object} client_representation - An object containing all the values that should be created for the client.
   * @returns {Promise<void>} Resolves when the client is created.
   */
  async create_client(clientId, client_representation) {
    const client_secret = await this.client_secret(clientId);

    const host = client_representation.redirectHost ?? clientId;
    const url = `http${this.secure}://${host}.${this.base_url}`;

    const client = {
      id: clientId,
      clientId,
      name: client_representation.name,
      rootUrl: url,
      adminUrl: url,
      baseUrl: url,
      enabled: true,
      secret: client_secret,
      defaultRoles: client_representation.defaultRoles,
      redirectUris: [`${url}${client_representation.redirectPath}`],
      attributes: {
        "backchannel.logout.session.required": "true",
        "post.logout.redirect.uris": url,
      },
    };

    await this.openid_create({
      name:     `realm client ${clientId}`,
      tokensrc: this.get_initial_access_token,
      path:     `admin/realms/${this.realm}/clients`,
      method:   "POST",
      body:     client,
    });

    if (client_representation.roles)
      await this.create_client_roles(client.id, client_representation.roles, host);
  }

  /**
   * Create roles for a client by POSTing to the OpenID service.
   *
   * @async
   * @param {string} clientId - The UUID of the client to create roles for.
   * @param {Array} roles - Array of role configurations.
   * @param {string} containerId - The container ID for the roles (name of the client).
   * @returns {Promise<void>} Resolves when all roles are created.
   */
  async create_client_roles(clientId, roles, containerId) {
    for (const role of roles) {
      const role_representation = {
        id: crypto.randomUUID(),
        name: role.name,
        composite: false,
        clientRole: true,
        containerId: containerId,
      };

      await this.openid_create({
        name:     `role ${role.name} for client ${clientId}`,
        tokensrc: this.get_initial_access_token,
        path:     `admin/realms/${this.realm}/clients/${clientId}/roles`,
        method:   "POST",
        body:     role_representation,
      });
    }
  }

  /**
   * Create the admin user in the OpenID service.
   * @async
   * @returns {Promise<void>} Resolves when the user is created.
   */
  async create_admin_user() {
    const { username, password } = this.fplus.opts;

    this.log("Setting up %s account", username);
    /* Attempt a login as the admin user. This will fail if the user
     * profile hasn't been created yet but will create the user on the
     * OpenID side as a side-effect. We need to use the client secret
     * here as OAuth doesn't appear to provide any way for users to log
     * in on their own account. */
    await this.fetch_token(this.realm, {
      grant_type:     "password",
      client_id:      "admin-cli",
      client_secret:  this.admin_cli_secret,
      username,
      password,
    }).catch(FetchError.expect(400));

    /* Fetch the user id (allocated by Keycloak) */
    const id = await this.get_user_id(username);

    const admin_user = {
      firstName: "Admin",
      lastName: "User",
      email: `${username}@${this.acs_realm}`,
      emailVerified: false,
    };

    /* Update the profile */
    await this.openid_create({
      name:     `admin profile`,
      tokensrc: this.get_user_management_token,
      method:   "PUT",
      path:     `admin/realms/${this.realm}/users/${id}`,
      body:     admin_user,
    });

    return id;
  }

  /**
    * Create client-level role mapping for the admin user.

    * @async
    * @param {string} client_id - The ID of the client containing the role.
    * @param {string} role_name - The name of the role.
    * @returns {Promise<void>} Resolves when the mapping is created.
    */
  async create_client_role_mappings (client_id, roles) {
    const { admin_user_id, realm } = this;

    const path = `admin/realms/${realm}/users/${admin_user_id}/role-mappings/clients/${client_id}`;

    const get_roles = type => this.with_token(
      this.get_user_management_token,
      new Request(this.url(`${path}/${type}`))
    ).then(res => res.json());

    const want = new Set(roles);

    const assigned = await get_roles("");
    const have = assigned.map(r => r.name).filter(n => want.has(n));
    for (const name of have) {
      this.log("Admin already has role %s for %s", name, client_id);
      want.delete(name);
    }

    const available = await get_roles("available");
    const assign = available.filter(r => want.has(r.name));

    if (assign.length != want.size) {
      this.log("Required roles: %s", [...want].join(", "));
      this.log("Available roles: %s", assign.map(r => r.name).join(", "));
      throw new Error("Not all required roles are available");
    }

    await this.openid_create({
      name:     `role mapping for ${client_id}`,
      tokensrc: this.get_user_management_token,
      method:   "POST",
      path,
      body:     assign,
    });
  }

  /**
   * Get the ID of the admin user. This isn't the same as the ID given during creation.
   *
   * @async
   * @returns {Promise<string>} Resolves to the admin user ID.
   */
  async get_user_id(username) {
    const user_query_url = this.url(`admin/realms/${this.realm}/users?exact=true&username=${username}`);

    const response = await this.with_token(
      this.get_user_management_token,
      new Request(user_query_url));

    const data = await response.json();
    const id = data[0]?.id;
    if (id == null)
      throw new Error(`User ${username} doesn't exist`);
    return id;
  }

  /**
   * Fetch an initial access token for the user in the specified realm. This should only be used during realm setup.
   *
   * Sets the `access_token` and `refresh_token` properties of `OAuthRealm` as a side effect.
   *
   * @async
   * @param {boolean} force - Do we need a fresh token?
   * @returns {Promise<string>} Resolves to an access token
   */
  async get_initial_access_token(force) {
    const { access_token, refresh_token } = this;

    if (access_token && !force)
      return access_token;

    const params = {
      client_id: "admin-cli",
      ...(refresh_token ? {
          grant_type:   "refresh_token",
          refresh_token,
        } : {
          grant_type:   "password",
          username:     this.username,
          password:     this.password,
        }),
    };

    const data = await this.fetch_token("master", params);

    this.access_token = data.access_token;
    this.refresh_token = data.refresh_token;
    return data.access_token;
  }

  /**
   * Fetch a token for the user management client in the Factory+ realm.
   *
   * Sets the `user_management_token` property of `OAuthRealm` as a side effect.
   *
   * @async
   * @param {boolean} force - Do we need a fresh token?
   * @returns {Promise<string>} Resolves to an access token.
   */
  async get_user_management_token(force) {
    if (this.user_management_token && !force)
      return this.user_management_token;

    const data = await this.fetch_token(this.realm, {
      grant_type:     "client_credentials",
      client_id:      "admin-cli",
      client_secret:  this.admin_cli_secret,
    });

    this.user_management_token = data.access_token;
    return data.access_token;
  }
}
