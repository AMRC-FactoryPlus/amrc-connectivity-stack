# AMRC Connectivity Stack

The AMRC Connectivity Stack (ACS) is a Kubernetes Helm chart that contains a comprehensive set of open-source services developed by the AMRC that enables an end-to-end implementation of the Factory+ framework.

## Prerequisites
Ensure that you familiarise yourself with the concepts of both Kubernetes and [Factory+](factoryplus.app.amrc.co.uk) before continuing. This chart installs a full end-to-end deployment of Factory+ onto a Kubernetes cluster and there are a lot of moving parts.

## Known Limitations
- Although Factory+ and ACS fully supports edge-based Cell Gateways, this chart does not support the deployment of edge-based Cell Gateways located on other Kubernetes Clusters, which is recommended in production. This is due to the fact that the chart deploys manifests to Cell Gateways, which requires the nodes to be on the same cluster. We already have a proof-of-concept implementation of how to address this and we aim to update this Helm chart in the near future to support.

## Get Started
This chart can be installed onto a local Kubernetes cluster for development or testing by following the instructions below. For production deployments, please refer to the [production deployment guide](#production-deployment).

### Install Helm
Helm is a package manager for Kubernetes that allows you to easily install and manage applications on Kubernetes. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Helm, follow the instructions [here](https://helm.sh/docs/intro/install/).

### Install Kubectl
Kubectl is a command-line tool for controlling Kubernetes clusters. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Kubectl, follow the instructions [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

### Install Minikube
Minikube is a tool that allows you to run a local Kubernetes cluster on your machine. It is not required to deploy ACS, but it is recommended for development and testing. To install Minikube, follow the instructions [here](https://minikube.sigs.k8s.io/docs/start/).

### Verify Installation
To verify that Helm and Kubectl have been installed correctly, run the following commands:
```bash
helm version
kubectl version
minikube version
```

Next, create a new MiniKube cluster by running the following command:
```bash
minikube start
```

To verify that you can connect to your MiniKube cluster, run the following command:
```bash
kubectl cluster-info
```

### Configure Base URL
This Chart creates a load balancer on your Kubernetes cluster that exposes all services at various subdomain. Please ensure that you have a wildcard DNS entry configured to direct all *.<baseURL> requests to the load balancer.

### Install ACS

Now it's time to install the AMRC Connectivity Stack. It's recommended that you utilise a tool like Lens to view the cluster status as it bootstraps to ensure that everything is working as expected. Lens can be downloaded [here](https://k8slens.dev/).

First, add the AMRC Factory+ Helm repository:
```bash
helm repo add amrc-factoryplus https://amrc-factoryplus.github.io/helm
helm repo update
```

Next, create a `values.yaml` file in a sensible location on your local machine. This file will be used to configure the deployment and can contain many options for customisation and configuration (see [values](#values) for more information). At the very least, you should set the following values:
```yaml
acs:
  baseUrl: localhost # Set this to the domain that ACS will be served from. Localhost should suffice for development.
  organisation: AMRC # Set this to the name of your organisation. It will be used across the deployment for branding and naming.
  secure: false # Set this to true if you want to serve ACS over HTTPS. This is recommended for production deployments but can be turned for development.
  tlsSecretName: factoryplus-tls # Set this to the name of the secret containing the wildcard certificate for the above domain. This is only required if secure is set to true.
```

Finally, install ACS by running the following command:
```bash
helm install acs amrc-factoryplus/acs -f values.yaml
```

If all went to plan you should now have a fully functioning ACS deployment beginning to deploy to your local Kubernetes cluster. Note that it can take a few minutes to have all services operational.

Take note of the service URLs printed at the end of the installation. You will need these to connect to the various services.

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

| Key                                       | Type   | Default                         | Description                                                                                                                                                                                 |
|-------------------------------------------|--------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| acs.baseUrl                               | string | `"localhost"`                   | The base URL that services will be served from                                                                                                                                              |
| acs.organisation                          | string | `"AMRC"`                        | The organisation where ACS is being deployed                                                                                                                                                |
| acs.secure                                | bool   | `true`                          | Whether or not services should be served over HTTPS                                                                                                                                         |
| acs.tlsSecretName                         | string | `"factoryplus-tls"`             | The name of the secret holding the wildcard certificate for the above domain.                                                                                                               |
| auth.image.registry                       | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Authorisation component                                                                                                                                                 |
| auth.image.repository                     | string | `"acs-auth"`                    | The repository of the Authorisation component                                                                                                                                               |
| auth.image.tag                            | string | `"latest"`                      | The tag of the Authorisation component                                                                                                                                                      |
| cmdesc.image.registry                     | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Commands component                                                                                                                                                      |
| cmdesc.image.repository                   | string | `"acs-cmdesc"`                  | The repository of the Commands component                                                                                                                                                    |
| cmdesc.image.tag                          | string | `"latest"`                      | The tag of the Commands component                                                                                                                                                           |
| cmdesc.verbosity                          | int    | `1`                             | Possible values are either 1 to enable all possible debugging, or a comma-separated list of debug tags (the tags printed before the log lines). No logging is specified as an empty string. |
| configdb.image.registry                   | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Configuration Store component                                                                                                                                           |
| configdb.image.repository                 | string | `"acs-configdb"`                | The repository of the Configuration Store component                                                                                                                                         |
| configdb.image.tag                        | string | `"latest"`                      | The tag of the Configuration Store component                                                                                                                                                |
| directory.image.registry                  | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Directory component                                                                                                                                                     |
| directory.image.repository                | string | `"acs-directory"`               | The repository of the Directory component                                                                                                                                                   |
| directory.image.tag                       | string | `"latest"`                      | The tag of the Directory component                                                                                                                                                          |
| identity.identity.image.registry          | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Identity component                                                                                                                                                      |
| identity.identity.image.repository        | string | `"acs-identity"`                | The repository of the Identity component                                                                                                                                                    |
| identity.identity.image.tag               | string | `"latest"`                      | The tag of the Identity component                                                                                                                                                           |
| identity.krbKeysOperator.image.registry   | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the KerberosKey Operator                                                                                                                                                    |
| identity.krbKeysOperator.image.repository | string | `"acs-krb-keys-operator"`       | The repository of the KerberosKey Operator                                                                                                                                                  |
| identity.krbKeysOperator.image.tag        | string | `"latest"`                      | The tag of the KerberosKey Operator                                                                                                                                                         |
| identity.realm                            | string | `"LOCALHOST"`                   | The Kerberos realm for this Factory+ deployment.                                                                                                                                            |
| manager.debug                             | bool   | `false`                         | Whether debug mode is enabled. DO NOT USE THIS IN PRODUCTION.                                                                                                                               |
| manager.edge.registry                     | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Edge Agent component                                                                                                                                                    |
| manager.edge.repository                   | string | `"acs-edge"`                    | The repository of the Edge Agent component                                                                                                                                                  |
| manager.edge.tag                          | string | `"latest"`                      | The tag of the Edge Agent component                                                                                                                                                         |
| manager.env                               | string | `"production"`                  | The environment that the manager is running in                                                                                                                                              |
| manager.image.registry                    | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Manager component                                                                                                                                                       |
| manager.image.repository                  | string | `"acs-manager"`                 | The repository of the Manager component                                                                                                                                                     |
| manager.image.tag                         | string | `"latest"`                      | The tag of the Manager component                                                                                                                                                            |
| manager.logLevel                          | string | `"warning"`                     | The minimum log level that the manager will log messages at                                                                                                                                 |
| manager.meilisearch.key                   | string | `"masterKey"`                   | The key that the manager uses to connect to the Meilisearch search engine                                                                                                                   |
| manager.name                              | string | `"Factory+ Manager"`            | A string used to customise the branding of the manager                                                                                                                                      |
| minio.exposeConsole                       | bool   | `false`                         | Whether or not to expose the MinIO console outside of the cluster                                                                                                                           |
| mqtt.image.registry                       | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the MQTT component                                                                                                                                                          |
| mqtt.image.repository                     | string | `"acs-mqtt"`                    | The repository of the MQTT component                                                                                                                                                        |
| mqtt.image.tag                            | string | `"latest"`                      | The tag of the MQTT component                                                                                                                                                               |
| warehouse.ingester.image.registry         | string | `"ghcr.io/amrc-factoryplus"`    | The registry of the Commands component                                                                                                                                                      |
| warehouse.ingester.image.repository       | string | `"influxdb-sparkplug-ingester"` | The repository of the Commands component                                                                                                                                                    |
| warehouse.ingester.image.tag              | string | `"latest"`                      | The tag of the Commands component                                                                                                                                                           |
----------------------------------------------