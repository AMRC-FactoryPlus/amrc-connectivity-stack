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
    this.access_token = "";
    this.refresh_token = "";
    this.user_management_access_token = "";
    this.config = service_setup.config;
    this.admin_cli_id = crypto.randomUUID();
    this.admin_cli_secret = crypto.randomUUID();
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
    let base_realm = {
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
          id: this.admin_cli_id,
          clientId: "admin-cli",
          name: "${client_admin-cli}",
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
              containerId: this.admin_cli_id,
              attributes: {},
            },
            {
              id: crypto.randomUUID(),
              name: "uma_protection",
              composite: false,
              clientRole: true,
              containerId: this.admin_cli_id,
              attributes: {},
            },
            {
              id: crypto.randomUUID(),
              name: "manage-realm",
              description: "",
              composite: false,
              clientRole: true,
              containerId: this.admin_cli_id,
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

    await this.get_initial_access_token();
    await this.create_basic_realm(base_realm, false);
    await this.create_admin_user(false);

    const client_configs = Object.entries(this.config.openidClients);
    const enabled_clients = client_configs.filter(
      ([name, client]) => client.enabled === true,
    );
    for (const [name, client] of enabled_clients) {
      await this.create_client(name, client, false);
      await this.create_client_role_mapping(client.clientId, client.adminRole);
    }
  }

  /**
   * Create a new realm by POSTing to the OpenID service. Throws if the response is not ok.
   *
   * @async
   * @param {Object} realm_representation - An object containing all the values that should be created for the realm.
   * @param {Boolean} is_retry - Whether the request is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<void>} Resolves when the realm is created.
   */
  async create_basic_realm(realm_representation, is_retry) {
    const realm_url = `http${this.secure}://openid.${this.base_url}/admin/realms`;

    this.log(`Attempting basic realm creation at: ${realm_url}`);

    const response = await fetch(realm_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.access_token}`,
      },
      body: JSON.stringify(realm_representation),
    });

    if (response.ok) {
      this.log("Created new realm: %o", realm_representation);
    } else {
      const status = response.status;

      if (status == 401 && !is_retry) {
        await this.get_initial_access_token(this.refresh_token);
        await this.create_basic_realm(realm_representation, true);
      } else if (status == 409) {
        this.log("Realm already exists");
      } else if (status == 503) {
        await setTimeout(10000);
        await this.create_basic_realm(realm_representation, false);
      } else {
        const error = await response.text();
        throw new Error(`${status}: ${error}`);
      }
    }
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
    const secret_path = path.join("/etc/secret", name);
    const content = await fs.readFile(secret_path, "utf8");
    const client_secret = content.trim();

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

    const client_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/clients`;

    this.log(`Attempting client creation at: ${client_url}`);

    try {
      const response = await fetch(client_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.access_token}`,
        },
        body: JSON.stringify(client),
      });

      if (response.ok) {
        this.log("Created new realm client: %o", client);
        if (
          client_representation.roles &&
          Array.isArray(client_representation.roles)
        ) {
          await this.create_client_roles(
            client.id,
            client_representation.roles,
            host,
          );
        }
      } else {
        const status = response.status;

        if (status == 401 && !is_retry) {
          await this.get_initial_access_token(this.refresh_token);
          await this.create_client(client_representation, true);
        } else if (status == 409) {
          this.log("Client %o already exists", name);
        } else if (status == 503) {
          await setTimeout(10000);
          await this.create_client(client_representation, false);
        } else {
          const error = await response.text();
          throw new Error(`${status}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Couldn't setup client: ${error}`);
    }
  }

  /**
   * Create roles for a client by POSTing to the OpenID service.
   *
   * @async
   * @param {string} clientId - The UUID of the client to create roles for.
   * @param {Array} roles - Array of role configurations.
   * @param {string} containerId - The container ID for the roles (name of the client).
   * @param {Boolean} is_retry - Whether this is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<void>} Resolves when all roles are created.
   */
  async create_client_roles(clientId, roles, containerId, is_retry = false) {
    const roles_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/clients/${clientId}/roles`;

    this.log(`Creating roles for client ${containerId} at: ${roles_url}`);

    for (const role of roles) {
      const role_representation = {
        id: crypto.randomUUID(),
        name: role.name,
        composite: false,
        clientRole: true,
        containerId: containerId,
      };

      try {
        const response = await fetch(roles_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.access_token}`,
          },
          body: JSON.stringify(role_representation),
        });

        if (response.ok) {
          this.log(`Created role '${role.name}' for client '${clientId}'`);
        } else {
          const status = response.status;

          if (status == 401 && !is_retry) {
            await this.get_initial_access_token(this.refresh_token);
            await this.create_client_roles(clientId, roles, containerId, true);
            break;
          } else if (status == 409) {
            this.log(
              `Role '${role.name}' already exists for client '${containerId}'`,
            );
          } else if (status == 503) {
            await setTimeout(10000);
            await this.create_client_roles(clientId, roles, containerId, false);
            break;
          } else {
            const error = await response.text();
            throw new Error(`${status}: ${error}`);
          }
        }
      } catch (error) {
        this.log(
          `Couldn't create role '${role.name}' for client '${clientId}': ${error}`,
        );
      }
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

    const user_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/users`;

    this.log(`Attempting admin user creation at: ${user_url}`);

    try {
      const response = await fetch(user_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.user_management_access_token}`,
        },
        body: JSON.stringify(admin_user),
      });

      if (response.ok) {
        this.log("Created new realm: %o", admin_user);
      } else {
        const status = response.status;

        if (status == 401 && !is_retry) {
          await this.get_user_management_token();
          await this.create_admin_user(admin_user, true);
        } else if (status == 409) {
          this.log("Admin user %o already exists", admin_user);
        } else if (status == 503) {
          await setTimeout(10000);
          await this.create_admin_user(admin_user, false);
        } else {
          const error = await response.text();
          throw new Error(`${status}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Couldn't setup admin user: ${error}`);
    }
  }

  /**
    * Create client-level role mapping for the admin user.

    * @async
    * @param {string} client_id - The ID of the client containing the role.
    * @param {string} role_name - The name of the role.
    * @returns {Promise<void>} Resolves when the mapping is created.
    */
  async create_client_role_mapping(client_id, role_name) {
    const admin_user_id = await this.get_admin_user_id(false);
    const role_id = await this.get_client_role_id(
      client_id,
      admin_user_id,
      role_name,
    );

    const role_list = [
      {
        id: role_id,
        name: role_name,
      },
    ];

    const role_mapping_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/users/${admin_user_id}/role-mappings/clients/${client_id}`;

    this.log("Attempting role mapping using: %o", role_list);

    try {
      this.get_user_management_token();
      const response = await fetch(role_mapping_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.user_management_access_token}`,
        },
        body: JSON.stringify(role_list),
      });

      if (response.ok) {
        this.log(
          `Admin role mapping completed successfully for client ${client_id}`,
        );
      } else {
        const status = response.status;

        if (status == 401 && !is_retry) {
          await this.get_user_management_token();
          await this.create_client_role_mapping(client_id, role_name, true);
        } else if (status == 409) {
          this.log(`Role mapping for ${client_id} already done.`);
        } else if (status == 503) {
          await setTimeout(10000);
          await this.create_client_role_mapping(client_id, role_name, false);
        } else {
          const error = await response.text();
          throw new Error(`${status}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Couldn't setup client role mapping for ${client_id}: ${error}`);
    }
  }

  /**
   * Get the ID of the admin user. This isn't the same as the ID given during creation.
   *
   * @async
   * @param {Boolean} is_retry - Whether this is a retry after a 401. If this is false and a 401 is returned, this will retry after refreshing the token.
   * @returns {Promise<string>} Resolves to the admin user ID.
   */
  async get_admin_user_id(is_retry) {
    const user_query_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/users?exact=true&username=${this.username}`;

    await this.get_user_management_token();
    const response = await fetch(user_query_url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.user_management_access_token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data[0].id;
    } else {
      const status = response.status;

      if (status == 401 && !is_retry) {
        await this.get_user_management_token();
        return await this.get_admin_user_id(true);
      } else if (status == 503) {
        await setTimeout(10000);
        return await this.get_admin_user_id(false);
      } else {
        const error = await response.text();
        throw new Error(`${status}: ${error}`);
      }
    }
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
    const role_query_url = `http${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/users/${user_id}/role-mappings/clients/${client_id}/available`;

    await this.get_user_management_token();
    const response = await fetch(role_query, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.user_management_access_token}`,
      },
    });

    if (response.ok) {
      const roleList = await response.json();
      for (const role of roleList) {
        if (role.name === role_name) {
          return role.id;
        }
      }
      throw new Error(
        `No role found with role name ${role_name} in ${client_id} available for ${user_id}`,
      );
    } else {
      const status = response.status;

      if (status == 401 && !is_retry) {
        await this.get_user_management_token();
        return await this.get_client_role_id(
          client_id,
          user_id,
          role_name,
          true,
        );
      } else if (status == 503) {
        await setTimeout(10000);
        return await this.get_client_role_id(
          client_id,
          user_id,
          role_name,
          false,
        );
      } else {
        const error = await response.text();
        throw new Error(`${status}: ${error}`);
      }
    }
  }

  /**
   * Fetch an initial access token for the user in the specified realm. This should only be used during realm setup.
   *
   * Sets the `access_token` and `refresh_token` properties of `OAuthRealm` as a side effect.
   *
   * @async
   * @param {string | undefined} [refresh_token] - Optional refresh token. If this is passed we use it with bearer auth.
   * @returns {Promise<[string, string]} Resolves to an access token and a refresh token.
   */
  async get_initial_access_token(refresh_token) {
    const token_url = `http${this.secure}://openid.${this.base_url}/realms/master/protocol/openid-connect/token`;

    this.log(`Attempting token request at: ${token_url}`);

    const params = new URLSearchParams();
    if (refresh_token != undefined) {
      params.append("grant_type", "refresh_token");
      params.append("client_id", "admin-cli");
      params.append("refresh_token", refresh_token);
    } else {
      params.append("grant_type", "password");
      params.append("client_id", "admin-cli");
      params.append("username", this.username);
      params.append("password", this.password);
    }

    const response = await fetch(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    if (response.ok) {
      const data = await response.json();
      this.access_token = data.access_token;
      this.refresh_token = data.refresh_token;

      return [data.access_token, data.refresh_token];
    } else if (response.status == 503) {
      await setTimeout(10000);
      this.get_initial_access_token();
    } else {
      const status = response.status;
      const error = await response.text();
      throw new Error(`${status}: ${error}`);
    }
  }

  /**
   * Fetch a token for the user management client in the Factory+ realm.
   *
   * Sets the `user_management_access_token` property of `OAuthRealm` as a side effect.
   *
   * @async
   * @returns {Promise<string>} Resolves to an access token.
   */
  async get_user_management_token() {
    const token_url = `http${this.secure}://openid.${this.base_url}/realms/${this.realm}/protocol/openid-connect/token`;

    this.log(`Attempting token request at: ${token_url}`);

    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", "admin-cli");
    params.append("client_secret", this.admin_cli_secret);

    const response = await fetch(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    if (response.ok) {
      const data = await response.json();
      this.user_management_access_token = data.access_token;

      return data.access_token;
    } else if (response.status == 503) {
      await setTimeout(10000);
      this.get_user_management_token();
    } else {
      const status = response.status;
      const error = await response.text();
      throw new Error(`${status}: ${error}`);
    }
  }
}
