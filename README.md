# AMRC Connectivity Stack

![Version: 0.0.1](https://img.shields.io/badge/Version-0.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 1.0.0](https://img.shields.io/badge/AppVersion-1.0.0-informational?style=flat-square)

The AMRC Connectivity Stack (ACS) is a collection of open-source services developed by the AMRC that enables an end-to-end implementation of the Factory+ framework.

**Homepage:** <factoryplus.app.amrc.co.uk>

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Alex Godbehere | <alex.godbehere@amrc.co.uk> |  |

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| https://bitnami-labs.github.io/sealed-secrets/ | sealed-secrets | 2.8.1 |
| https://grafana.github.io/helm-charts | grafana | 6.52.4 |
| https://grafana.github.io/helm-charts | loki | 4.8.0 |
| https://grafana.github.io/helm-charts | promtail | 6.9.3 |
| https://helm.traefik.io/traefik | traefik | 10.19.* |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| acs.baseUrl | string | `"localhost"` | The base URL that services will be served from |
| acs.namespace | string | `"factory-plus"` | The K8s namespace to install the components in |
| acs.organisation | string | `"AMRC"` | The organisation where ACS is being deployed |
| acs.secure | bool | `true` | Whether or not services should be served over HTTPS |
| acs.tlsSecretName | string | `"factoryplus-tls"` | The name of the secret holding the wildcard certificate for the above domain. Only used if secure=true. |
| auth.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Authorisation component |
| auth.image.repository | string | `"acs-auth"` | The repository of the Authorisation component |
| auth.image.tag | string | `"latest"` | The tag of the Authorisation component |
| cmdesc.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Commands component |
| cmdesc.image.repository | string | `"acs-cmdesc"` | The repository of the Commands component |
| cmdesc.image.tag | string | `"latest"` | The tag of the Commands component |
| cmdesc.verbosity | int | `1` | Possible values are either 1 to enable all possible debugging, or a comma-separated list of debug tags (the tags printed before the log lines). No logging is specified as an empty string. |
| configdb.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Configuration Store component |
| configdb.image.repository | string | `"acs-configdb"` | The repository of the Configuration Store component |
| configdb.image.tag | string | `"latest"` | The tag of the Configuration Store component |
| directory.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Directory component |
| directory.image.repository | string | `"acs-directory"` | The repository of the Directory component |
| directory.image.tag | string | `"latest"` | The tag of the Directory component |
| identity.identity.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Identity component |
| identity.identity.image.repository | string | `"acs-identity"` | The repository of the Identity component |
| identity.identity.image.tag | string | `"latest"` | The tag of the Identity component |
| identity.krbKeysOperator.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the KerberosKey Operator |
| identity.krbKeysOperator.image.repository | string | `"acs-krb-keys-operator"` | The repository of the KerberosKey Operator |
| identity.krbKeysOperator.image.tag | string | `"latest"` | The tag of the KerberosKey Operator |
| identity.realm | string | `"LOCALHOST"` | The Kerberos realm for this Factory+ deployment. |
| manager.debug | bool | `false` | Whether debug mode is enabled. DO NOT USE THIS IN PRODUCTION. |
| manager.edge.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Edge Agent component |
| manager.edge.repository | string | `"acs-edge"` | The repository of the Edge Agent component |
| manager.edge.tag | string | `"latest"` | The tag of the Edge Agent component |
| manager.env | string | `"production"` | The environment that the manager is running in |
| manager.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Manager component |
| manager.image.repository | string | `"acs-manager"` | The repository of the Manager component |
| manager.image.tag | string | `"latest"` | The tag of the Manager component |
| manager.logLevel | string | `"warning"` | The minimum log level that the manager will log messages at |
| manager.meilisearch.key | string | `"masterKey"` | The key that the manager uses to connect to the Meilisearch search engine |
| manager.minio.key | string | `"management-app"` | The key that the management app uses to connect to MinIO |
| manager.minio.secret | string | `""` | The secret that the management app uses to connect to MinIO |
| manager.name | string | `"Factory+ Manager"` | A string used to customise the branding of the manager |
| minio.exposeConsole | bool | `false` | Whether or not to expose the MinIO console outside of the cluster |
| mqtt.image.registry | string | `"ghcr.io/amrc-factoryplus"` | The registry of the MQTT component |
| mqtt.image.repository | string | `"acs-mqtt"` | The repository of the MQTT component |
| mqtt.image.tag | string | `"latest"` | The tag of the MQTT component |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.11.0](https://github.com/norwoodj/helm-docs/releases/v1.11.0)
