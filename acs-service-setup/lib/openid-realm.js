import crypto from "crypto";
import { URLSearchParams } from "url";

/**
 * Create the startup OpenID realm `factory_plus`.
 *
 * @async
 * @param {ServiceSetup} service_setup - Contains the configuration for setting up the realm.
 * @returns {Promise<void>} Resolves when the realm creation process finishes.
 */
export async function create_openid_realm(service_setup) {
  new RealmSetup(service_setup).run();
}

class RealmSetup {
  constructor(service_setup) {
    const { fplus } = service_setup;
    this.log = fplus.debug.bound("oauth");

    this.username = fplus.opts.username;
    this.password = fplus.opts.password;
    this.realm = "factory_plus";
    this.base_url = fplus.acs_config.domain;
    this.secure = fplus.acs_config.secure;
    this.access_token = "";
    this.refresh_token = "";
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
                `HTTP/openid.${this.base_url}@${this.base_url.toUpperCase()}`,
              ],
              allowPasswordAuthentication: ["false"],
              debug: ["true"],
              keyTab: ["/etc/keytabs/krb5.keytab"],
              cachePolicy: ["DEFAULT"],
              updateProfileFirstLogin: ["false"],
              kerberosRealm: [this.base_url.toUpperCase()],
              enabled: ["true"],
            },
          },
        ],
      },
    };

    await this.get_initial_access_token();
    await this.create_basic_realm(base_realm, false);

    const client_configs = Object.values(fplus.config.openidClients);
    client_configs
      .filter((client) => client.enabled === true)
      .forEach((client) => this.create_client(client, false));
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
    const realm_url = `${this.secure}://openid.${this.base_url}/admin/realms`;

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
        const status = response.status();

        if (status == 401 && !is_retry) {
          await this.get_initial_access_token(this.refresh_token);
          await this.create_basic_realm(client_representation, true);
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
    const client = {
      id: crypto.randomUUID(),
      clientId: client_representation.clientId,
      name: client_representation.name,
      rootUrl: `${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      adminUrl: `${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      baseUrl: `${this.secure}://${client_representation.redirectHost}.${this.base_url}`,
      enabled: true,
      secret: client_representation.secret,
      redirectUris: [`${this.secure}://${client_representation.name}.${this.base_url}${client.redirectPath}`],
    }

    const client_url = `${this.secure}://openid.${this.base_url}/admin/realms/${this.realm}/clients`;

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
        const status = response.status();

        if (status == 401 && !is_retry) {
          await this.get_initial_access_token(this.refresh_token);
          await this.create_client(client_representation, true);
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
    const token_url = `${this.secure}://openid.${this.base_url}/realms/${this.realm}/protocol/openid-connect/token`;

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
        data = await response.json();
        this.access_token = data.access_token;
        this.refresh_token = data.refresh_token;

        return [data.access_token, data.refresh_token];
      } else {
        const status = response.status();
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
