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
    this.config = service_setup.config;
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
              allowPasswordAuthentication: ["false"],
              debug: ["true"],
              keyTab: ["/etc/keytabs/server"],
              cachePolicy: ["DEFAULT"],
              updateProfileFirstLogin: ["false"],
              kerberosRealm: [this.acs_realm],
              enabled: ["true"],
            },
          },
        ],
      },
    };

    await this.get_initial_access_token();
    await this.create_basic_realm(base_realm, false);

    const client_configs = Object.values(this.config.openidClients);
    const enabled_clients = client_configs.filter(
      (client) => client.enabled === true,
    );
    for (const client of enabled_clients) {
      await this.create_client(client, false);
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

    try {
      const response = await fetch(realm_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.access_token}`,
        },
        body: JSON.stringify(realm_representation),
      });

      if (!response.ok) {
        const status = response.status;

        if (status == 401 && !is_retry) {
          await this.get_initial_access_token(this.refresh_token);
          await this.create_basic_realm(realm_representation, true);
        } else if (status == 503) {
          await this.wait(10000);
          await this.create_basic_realm(realm_representation, false);
        } else {
          const error = await response.text();
          throw new Error(`${status}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Couldn't setup realm: ${error}`);
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
  async create_client(client_representation, is_retry) {
    const secret_path = path.join(
      "/etc/secret",
      client_representation.redirectHost,
    );
    const content = await fs.readFile(secret_path, "utf8");
    const client_secret = content.trim();

    const client = {
      id: crypto.randomUUID(),
      clientId: client_representation.clientId,
      name: client_representation.name,
      rootUrl: `http${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      adminUrl: `http${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      baseUrl: `http${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      enabled: true,
      secret: client_secret,
      redirectUris: [
        `http${this.secure}://${client_representation.redirectHost}.${this.base_url}${client_representation.redirectPath}`,
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

      if (!response.ok) {
        const status = response.status;

        if (status == 401 && !is_retry) {
          await this.get_initial_access_token(this.refresh_token);
          await this.create_client(client_representation, true);
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

    try {
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
    } catch (error) {
      this.log(
        `Couldn't get an initial access token for realm setup: ${error}`,
      );
    }
  }
}
