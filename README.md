# AMRC Connectivity Stack

The AMRC Connectivity Stack (ACS) is a Kubernetes Helm chart that contains a comprehensive set of open-source services developed by the AMRC that enables an end-to-end implementation of the Factory+ framework.

## Prerequisites
Ensure that you have `kubectl` access to an existing Kubernetes cluster and familiarise yourself with the concepts of both Kubernetes and [Factory+](https://factoryplus.app.amrc.co.uk) before continuing. This chart installs a full end-to-end deployment of Factory+ onto the cluster and there are a lot of moving parts.

## Known Limitations
Although Factory+ and ACS fully supports edge-based Cell Gateways, this chart does not support the deployment of edge-based Cell Gateways located on other Kubernetes Clusters, which is recommended in production. This is due to the fact that the chart deploys manifests to Cell Gateways, which requires the nodes to be on the same cluster. We already have a proof-of-concept implementation of how to address this and we aim to update this Helm chart in the near future to support.

## Get Started
This chart can be installed onto a local Kubernetes cluster for development or testing by following the instructions below. For production deployments, please refer to the [production deployment guide](#production-deployment).

### Install Helm
Helm is a package manager for Kubernetes that allows you to easily install and manage applications on Kubernetes. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Helm, follow the instructions [here](https://helm.sh/docs/intro/install/).

### Install Kubectl
Kubectl is a command-line tool for controlling Kubernetes clusters. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Kubectl, follow the instructions [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

### Install Lens

It's recommended that you utilise a tool like Lens to view the cluster
status as it bootstraps to ensure that everything is working as
expected. Lens can be downloaded [here](https://k8slens.dev/) or the
open-source version [here](https://github.com/MuhammedKalkan/OpenLens).

You will need to configure Lens with a Kubeconfig file to allow it to
connect to your Kubernetes cluster.

### Verify Installation
To verify that Helm and Kubectl have been installed correctly, run the following commands:
```bash
helm version
kubectl version
```

### Configure your ACS installation

In order to configure your ACS installation for your circumstances you
need to create a config file for Helm. This is conventionally called
`values.yaml` but can be called anything you like. Create the file in a
sensible location on your local machine; you will need this file again
when you upgrade your ACS installation. You may want to check it into
whatever version control you use locally.

The values file is in [YAML format](https://yaml.org/) and can contain
many options for customisation and configuration. Values specified in
your local file override the default values [specified in the Helm
chart](values.yaml) so you can see that file for reference. At the very
least you should set the following values but remember to change them to
your specific deployment:

```yaml
# This section has configuration for ACS overall.
acs:
  # Set this to the domain that ACS will be served from. This should be
  # the same as the wildcard DNS entry you created earlier.
  baseUrl: factoryplus.myorganisation.com

  # Set this to the name of your organisation. It will be used across
  # the deployment for branding and naming. In particular it will be
  # used as a prefix for your Sparkplug Group names.
  organisation: MYORGANISATION 

  # Set this to true if you want to serve ACS over HTTPS. This is
  # recommended for production deployments but can be turned off for
  # development.
  secure: false

  # Set this to the name of the secret containing the wildcard
  # certificate for the above domain. This is only required if secure is
  # set to true.
  tlsSecretName: factoryplus-tls

# This section has configuration for the identity component.
identity:
  # Set the identity realm for the deployment. This is used to namespace
  # the identity server and should be unique to your deployment. It is
  # recommended that you use the baseUrl in capitals for this value. If
  # you have existing Kerberos realms or Active Directory domains you
  # need to ensure you don't conflict with them.  
  realm: FACTORYPLUS.MYORGANISATION.COM
```

You also need to choose a Kubernetes namespace to install the ACS
components into. Currently the Helm chart installs into the fixed
namespaces `default` and `kubegres-system` in addition to the namespace
you nominate, and creates a number of cluster-wide objects such as
ClusterRoles.

### Configure DNS and TLS
This Chart creates a load balancer on your Kubernetes cluster that exposes all services at various subdomains. Please ensure that you have a wildcard DNS entry configured to direct all `*.<baseURL>` requests to your Kubernetes cluster.

If you have enabled `acs.secure` then you must also create a TLS secret on the cluster in the `default` namespace with the same name as the value specified in `acs.tlsSecretName`.

### Install a released version of ACS

Now it's time to install the AMRC Connectivity Stack. Follow these
instructions to install a released version; to install from a
development Git checkout use the section below instead.

First, add the AMRC Factory+ Helm repository:
```bash
helm repo add amrc-connectivity-stack https://amrc-factoryplus.github.io/amrc-connectivity-stack/build
helm repo update
```

Finally, install ACS by running the following command.
```bash
helm install acs amrc-connectivity-stack/amrc-connectivity-stack --version $version -f $values -n $namespace --create-namespace
```

Replace the `$variables` appropriately:

|Variable|Value|
|---|---|
|`$version`     | The version of ACS to install. |
|`$values`      | The path to your `values.yaml` file created above. |
|`$namespace`   | The Kubernetes namespace to use. |

The version number should be a specific version like `1.0.2` or a semver
requirement string like `^2.0.0`.

If all went to plan you should now have a fully functioning ACS deployment beginning to deploy to your local Kubernetes cluster. Note that it can take a few minutes to have all services operational.

Take note of the service URLs printed at the end of the installation. You will need these to connect to the various services.

### Upgrade to a released version of ACS

If you have an existing ACS install and you want to upgrade to a new
release, first make sure you check the release notes for the release.
If you are upgrading over a major version increment there may be manual
steps required. We do not support upgrades that skip major versions; if
you want to upgrade from N.x.y to N+2.x.y you need to upgrade to the
latest N+1.x.y first.

You can follow the same procedure to re-deploy with different settings
in your `values.yaml` file.

Run

```bash
helm repo update
```

to pull down any updates to the Helm chart. Then run

```bash
helm upgrade acs amrc-connectivity-stack/amrc-connectivity-stack -f $values --version $version
```

specifying the version to upgrade to. You need to use the same `$values`
file as before, but you don't need to re-specify the namespace.

### Installing a development version

If you are installing a development version of ACS start by cloning this
repo and switching to the branch/tag you want to install. Create a
`values.yaml` as above; don't create this inside the repo checkout,
create it somewhere else. In particular **don't** edit the `values.yaml`
file in this repo directly unless you are working on ACS itself.

Change directory to the repo checkout. Run

```bash
helm dependency update
```

to pull down appropriate versions of the dependent charts. It is
important to do this whenever you have updated your git checkout as the
dependecies may have changed. Now run

```bash
helm install acs . -f $values -n $namespace --create-namespace
```

The `.` for a chart name instructs Helm to install the chart in the
current directory rather than pulling a released version.

To upgrade a development install, or to change your `values.yaml`, run

```bash
helm upgrade acs . -f $values
```

### Verifying Installation

Get the password for the admin user by running the following command. Note that it may not return the password until the deployment has finished bootstrapping.

```bash
echo $(sudo kubectl get secret krb5-passwords -o jsonpath="{.data.admin}" -n {{.Release.Namespace}} | base64 --decode)
```

Once you have the admin password you can connect to the MQTT broker at the URL supplied to you and subscribe to spBv1.0/#. It's advisable to do this before you start adding devices to the system so that you can see all traffic. MQTTExplorer is a good tool for this and can be downloaded [here](https://mqtt-explorer.com/), however building the tool from [this](https://github.com/thomasnordquist/MQTT-Explorer/pull/712) pull request may be more useful when working with ACS and Sparkplug messages.

Next, log into the manager at the URL supplied to you as the `admin` user and create a `Group`, `Node` (Soft Gateway) and `Device`. Configure the device by completing the `Information`, `Connection`, and `Schema` tabs until you see a green `VALID` tag in the top right corner. Once you've configured the device you should see MQTT traffic begin to flow.

Finally, get the admin password for InfluxDB by running the following command and log into the InfluxDB instance as the admin user at at the URL supplied to you.

```bash
echo $(sudo kubectl get secret acs-influxdb2-auth -o jsonpath="{.data.admin-password}" -n {{.Release.Namespace}} | base64 --decode)
```

## Production Deployment

Production deployment does not differ greatly from development deployment, however there are a few things to note:

- Ensure that you have a wildcard DNS entry configured to direct all *.<baseURL> requests to the load balancer.
- Ensure that you have a wildcard TLS certificate for the domain specified in `baseUrl`
- Ensure that `secure` is set to `true`
- Only use `admin` user for disaster recovery

## Maintainers

| Name           | Email                       |
|----------------|-----------------------------|
| Alex Godbehere | <alex.godbehere@amrc.co.uk> |
| Ben Morrow     | <b.morrow@amrc.co.uk>       |

## Requirements

| Repository                                      | Name           | Version |
|-------------------------------------------------|----------------|---------|
| https://alexgodbehere.github.io/helm-repository | operator       | 5.0.4   |
| https://bitnami-labs.github.io/sealed-secrets/  | sealed-secrets | 2.8.1   |
| https://grafana.github.io/helm-charts           | grafana        | 6.52.4  |
| https://grafana.github.io/helm-charts           | loki           | 4.8.0   |
| https://grafana.github.io/helm-charts           | promtail       | 6.9.3   |
| https://helm.influxdata.com/                    | influxdb2      | 2.1.1   |
| https://helm.traefik.io/traefik                 | traefik        | 10.19.* |
| https://operator.min.io                         | tenant         | 5.0.3   |

## Values
| Key                                       | Type   | Default | Description |
|-------------------------------------------|--------|---------|-------------|
| acs.baseUrl                               | string | `"factoryplus.myorganisation.com"` | The base URL that services will be served from |
| acs.organisation                          | string | `"AMRC"` | The organisation where ACS is being deployed |
| acs.secure                                | bool   | `true` | Whether or not services should be served over HTTPS |
| acs.tlsSecretName                         | string | `"factoryplus-tls"` | The name of the secret holding the wildcard certificate for the above domain. |
| auth.enabled                              | bool   | `true` | Whether or not to enable the Authorisation component |
| auth.image.registry                       | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Authorisation component |
| auth.image.repository                     | string | `"acs-auth"` | The repository of the Authorisation component |
| auth.image.tag                            | string | `"latest"` | The tag of the Authorisation component |
| cmdesc.enabled                            | bool   | `true` | Whether or not to enable the Commands component |
| cmdesc.image.registry                     | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Commands component |
| cmdesc.image.repository                   | string | `"acs-cmdesc"` | The repository of the Commands component |
| cmdesc.image.tag                          | string | `"latest"` | The tag of the Commands component |
| cmdesc.verbosity                          | int    | `1` | Possible values are either 1 to enable all possible debugging, or a comma-separated list of debug tags (the tags printed before the log lines). No logging is specified as an empty string. |
| configdb.enabled                          | bool   | `true` | Whether or not to enable the Configuration Store component |
| configdb.image.registry                   | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Configuration Store component |
| configdb.image.repository                 | string | `"acs-configdb"` | The repository of the Configuration Store component |
| configdb.image.tag                        | string | `"latest"` | The tag of the Configuration Store component |
| directory.enabled                         | bool   | `true` | Whether or not to enable the Directory component |
| directory.image.registry                  | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Directory component |
| directory.image.repository                | string | `"acs-directory"` | The repository of the Directory component |
| directory.image.tag                       | string | `"latest"` | The tag of the Directory component |
| identity.enabled                          | bool   | `true` | Whether or not to enable the Identity component |
| identity.identity.image.registry          | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Identity component |
| identity.identity.image.repository        | string | `"acs-identity"` | The repository of the Identity component |
| identity.identity.image.tag               | string | `"latest"` | The tag of the Identity component |
| identity.krbKeysOperator.namespaces       | string | `""` | A comma-separated list of namespaces that the KerberosKey Operator should watch for KerberosKey resources in. Defaults to the release namespace if not specified |
| identity.krbKeysOperator.image.registry   | string | `"ghcr.io/amrc-factoryplus"` | The registry of the KerberosKey Operator |
| identity.crossRealm                       | array  | `[]` | Enable support for cross-realm authentication |
| identity.krbKeysOperator.image.repository | string | `"acs-krb-keys-operator"` | The repository of the KerberosKey Operator |
| identity.krbKeysOperator.image.tag        | string | `"latest"` | The tag of the KerberosKey Operator |
| identity.realm                            | string | `"FACTORYPLUS.MYORGANISATION.COM"` | The Kerberos realm for this Factory+ deployment. |
| manager.debug                             | bool   | `false` | Whether debug mode is enabled. DO NOT USE THIS IN PRODUCTION. |
| manager.edge.registry                     | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Edge Agent component |
| manager.edge.repository                   | string | `"acs-edge"` | The repository of the Edge Agent component |
| manager.edge.tag                          | string | `"latest"` | The tag of the Edge Agent component |
| manager.enabled                           | bool   | `true` | Whether or not to enable the Manager component |
| manager.env                               | string | `"production"` | The environment that the manager is running in |
| manager.image.registry                    | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Manager component |
| manager.image.repository                  | string | `"acs-manager"` | The repository of the Manager component |
| manager.image.tag                         | string | `"latest"` | The tag of the Manager component |
| manager.logLevel                          | string | `"warning"` | The minimum log level that the manager will log messages at |
| manager.meilisearch.key                   | string | `"masterKey"` | The key that the manager uses to connect to the Meilisearch search engine |
| manager.name                              | string | `"Factory+ Manager"` | A string used to customise the branding of the manager |
| minio.enabled                             | bool   | `true` | Whether or not to enable MinIO |
| minio.exposeConsole                       | bool   | `false` | Whether or not to expose the MinIO console outside of the cluster |
| mqtt.enabled                              | bool   | `true` | Whether or not to enable the MQTT component |
| mqtt.image.registry                       | string | `"ghcr.io/amrc-factoryplus"` | The registry of the MQTT component |
| mqtt.image.repository                     | string | `"acs-mqtt"` | The repository of the MQTT component |
| mqtt.image.tag                            | string | `"latest"` | The tag of the MQTT component |
| postgres.enabled                          | bool   | `true` | Whether or not to enable Postgres |
| warehouse.ingester                        | object | `{"enabled":true,"image":{"registry":"ghcr.io/amrc-factoryplus","repository":"influxdb-sparkplug-ingester","tag":"latest"}}` | Whether or not to enable the Warehouse component |
| warehouse.ingester.image.registry         | string | `"ghcr.io/amrc-factoryplus"` | The registry of the Warehouse component |
| warehouse.ingester.image.repository       | string | `"influxdb-sparkplug-ingester"` | The repository of the Warehouse component |
| warehouse.ingester.image.tag              | string | `"latest"` | The tag of the Warehouse component |

----------------------------------------------
