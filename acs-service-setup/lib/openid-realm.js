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

    this.username = fplus.opts.username;
    this.password = fplus.opts.password;
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
      return this.try_fetch(request);
    }

    await FetchError.throwOf(response);
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
    const doit = fetch(request);
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

    const created = this.with_token(opts.tokensrc, request)
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
    this.admin_cli_secret = await this.client_secret("_admin");

    await this.create_basic_realm();
    await this.create_admin_user();

    const client_configs = Object.entries(this.config.openidClients);
    const enabled_clients = client_configs.filter(
      ([name, client]) => client.enabled === true,
    );
    for (const [name, client] of enabled_clients) {
      await this.create_client(name, client);
      await this.create_client_role_mapping(client.clientId, client.adminRole);
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
      name:     `realm %o`,
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
   * @param {Boolean} is_retry - Whether the request is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<void>} Resolves when the client is created.
   */
  async create_client(name, client_representation, is_retry) {
    const client_secret = await this.client_secret(name);

    const host = client_representation.redirectHost ?? name;
    const url = `http${this.secure}://${host}.${this.base_url}`;

    const client = {
      id: client_representation.clientId,
      clientId: client_representation.clientId,
      name: client_representation.name,
      rootUrl: url,
      adminUrl: url,
      baseUrl: url,
      enabled: true,
      secret: client_secret,
      defaultRoles: [client_representation.defaultRole],
      redirectUris: [`${url}${client_representation.redirectPath}`],
      attributes: {
        "backchannel.logout.session.required": "true",
        "post.logout.redirect.uris": url,
      },
      protocolMappers: [
        {
          name: "client roles",
          protocol: "openid-connect",
          protocolMapper: "oidc-usermodel-client-role-mapper",
          consentRequired: false,
          config: {
            "introspection.token.claim": "true",
            multivalued: "true",
            "userinfo.token.claim": "true",
            "id.token.claim": "true",
            "lightweight.claim": "false",
            "access.token.claim": "true",
            "claim.name": "${client_id}.roles",
            "jsonType.label": "String",
            "usermodel.clientRoleMapping.clientId":
              client_representation.clientId,
          },
        },
      ],
    };

    await this.openid_create({
      name:     `realm client %o`,
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
        name:     `Role ${role.name} for client ${clientId}`,
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
   * @param {Boolean} is_retry - Whether this is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<void>} Resolves when the user is created.
   */
  async create_admin_user(is_retry) {
    const admin_user = {
      id: crypto.randomUUID(),
      userName: this.username,
      firstName: "Admin",
      lastName: "User",
      email: `admin@${this.acs_realm}`,
      emailVerified: false,
      enabled: true,
      serviceAccountClientId: "admin-cli",
      credentials: {
        type: "password",
        value: this.password,
        temporary: "false",
      },
    };

    await this.openid_create({
      name:     `Admin user`,
      tokensrc: this.get_user_management_token,
      method:   "POST",
      path:     `admin/realms/${this.realm}/users`,
      body:     admin_user,
    });
  }

  /**
    * Create client-level role mapping for the admin user.

    * @async
    * @param {string} client_id - The ID of the client containing the role.
    * @param {string} role_name - The name of the role.
    * @returns {Promise<void>} Resolves when the mapping is created.
    */
  async create_client_role_mapping(client_id, role_name) {
    const admin_user_id = await this.get_admin_user_id();
    const role_id = await this.get_client_role_id(client_id, admin_user_id, role_name);

    const role_list = [
      {
        id: role_id,
        name: role_name,
      },
    ];

    const path = `admin/realms/${this.realm}/users/${admin_user_id}/role-mappings/clients/${client_id}`;
    await this.openid_create({
      name:     `Role mapping for ${client_id}`,
      tokensrc: this.get_user_management_token,
      method:   "POST",
      path,
      body:     role_list,
    });
  }

  /**
   * Get the ID of the admin user. This isn't the same as the ID given during creation.
   *
   * @async
   * @returns {Promise<string>} Resolves to the admin user ID.
   */
  async get_admin_user_id() {
    const user_query_url = this.url(`admin/realms/${this.realm}/users?exact=true&username=${this.username}`);

    const response = await this.with_token(
      this.get_user_management_token,
      new Request(user_query_url));

    const data = await response.json();
    return data[0].id;
  }

  /**
   * Get the ID of the applicable role given the containing client ID, the user ID, and the role name.
   *
   * @async
   * @param {string} client_id - ID of the client containing the role.
   * @param {string} user_id - ID of the user to which the role will apply.
   * @param {string} role_name - Name of the role.
   * @param {Boolean} is_retry - Whether this is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<string>} Resolves to the ID of the role.
   */
  async get_client_role_id(client_id, user_id, role_name, is_retry) {
    const role_query_url = this.url(`admin/realms/${this.realm}/users/${user_id}/role-mappings/clients/${client_id}/available`);

    const response = await this.with_token(
      this.get_user_management_token,
      new Request(role_query_url));

    const roleList = await response.json();
    for (const role of roleList) {
      if (role.name === role_name) {
        return role.id;
      }
    }
    throw new Error(
      `No role found with role name ${role_name} in ${client_id} available for ${user_id}`,
    );
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

    const token_url = this.url(`realms/master/protocol/openid-connect/token`);

    this.log(`Attempting token request at: ${token_url}`);

    const params = new URLSearchParams();
    if (this.refresh_token != undefined) {
      params.append("grant_type", "refresh_token");
      params.append("client_id", "admin-cli");
      params.append("refresh_token", refresh_token);
    } else {
      params.append("grant_type", "password");
      params.append("client_id", "admin-cli");
      params.append("username", this.username);
      params.append("password", this.password);
    }

    const response = await this.try_fetch(new Request(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }));

    const data = await response.json();
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

    const token_url = this.url(`/realms/${this.realm}/protocol/openid-connect/token`);

    this.log(`Attempting token request at: ${token_url}`);

    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", "admin-cli");
    params.append("client_secret", this.admin_cli_secret);

    const response = await this.try_fetch(new Request(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }));

    const data = await response.json();
    this.user_management_token = data.access_token;

    return data.access_token;
  }
}
