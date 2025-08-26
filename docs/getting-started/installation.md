# Installation
## Prerequisites

Ensure that you have `kubectl` access to an existing Kubernetes cluster and familiarise yourself with the concepts of both Kubernetes and [Factory+](https://factoryplus.app.amrc.co.uk) before continuing. This chart installs a full end-to-end deployment of Factory+ onto a central cluster and there are a lot of moving parts.

## Getting started

This chart can be installed onto a local Kubernetes cluster for development or testing by following the instructions below. For production deployments, please ensure that the deployment is secured as per the [TLS / Production Deployment](#production-deployment) section of this guide.

### Install Helm

Helm is a package manager for Kubernetes that allows you to easily install and manage applications on Kubernetes. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Helm, follow the instructions [here](https://helm.sh/docs/intro/install/).

### Install Kubectl

Kubectl is a command-line tool for controlling Kubernetes clusters. It must be installed on the machine that you'll be using to deploy ACS _from_. To install Kubectl, follow the instructions [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

### Configure DNS

This Chart creates a load balancer on your Kubernetes cluster that exposes all services at various subdomains. Please ensure that you have both a wildcard DNS `A Record` configured to direct all `*.<baseURL>` requests and a root `A Record` to direct all `<baseURL>` requests to your load balancer IP.

### Configure TLS

If `acs.letsEncrypt.enabled` is true (default) then ACS will utilise `cert-manager` and Let's Encrypt to automatically issue and renew TLS certificates for your ACS installation. Please note that the cluster's DNS will need to be resolvable via the internet for this to work. If you intend on utilising Let's Encrypt to handle certificates for you then you need to ensure that the cert-manager CRDs are installed onto your cluster.

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.crds.yaml
```

> Please ensure that you set a valid email address in `acs.letsEncrypt.email` before installing.

#### Bringing your own certificate
If you'd prefer to use your own certificate, create a wildcard TLS secret in your namespace with the name of `acs.tlsSecretName` (`factoryplus-tls` by default) and set the `acs.letsEncrypt.enabled` value to `false`.

#### Development (insecure) deployment

To deploy a development/testing instance without TLS set:

- `acs.secure` to `false`
- `acs.letsEncrypt.enabled` to `false`
- `traefik.ports.mqtt.expose` to `true`

## Install ACS

Now it's time to install the AMRC Connectivity Stack. It's recommended that you utilise a tool like Lens to view the cluster status as it bootstraps to ensure that everything is working as expected. Lens can be downloaded [here](https://k8slens.dev/).

First, add the AMRC Factory+ Helm repository:

```bash
helm repo add amrc-connectivity-stack https://amrc-factoryplus.github.io/amrc-connectivity-stack/build
helm repo update
```

Next, create a `values.yaml` file in a sensible location on your local machine. This file will be used to configure the deployment and can contain many options for customisation and configuration (see [values](#values) for more information). At the very least you should set the following values but remember to change them to match your specific deployment. Please note that this will install a production-ready deployment of ACS with TLS enabled by default. To deploy an insecure development deployment, see the [Development (insecure) deployment](#development-insecure-deployment) section above.

```yaml
acs:
  baseUrl: factoryplus.myorganisation.com # Set this to the domain that ACS will be served from. This should be the same as the wildcard DNS entry you created earlier.
  organisation: MYORGANISATION # Set this to the name of your organisation. It will be used across the deployment for branding and naming.
  letsEncrypt:
    email: factoryplus@myorganisation.co.uk
identity:
  realm: FACTORYPLUS.MYORGANISATION.COM # Set the identity realm for the deployment. This is used to namespace the identity server and should be unique to your deployment. It is recommended that you use the baseUrl in capitals for this value.
```

Before we install, we need to create the `factory-plus` namespace, which is where all ACS services will be deployed to. If a different namespace is chosen by changing the `-n <namespace>` on the helm install command then ensure the namespace exists before installing ACS.

To create the `factory-plus` namespace, run the following command:

```bash
kubectl create namespace factory-plus
```

Finally, install ACS by running the following command.

```bash
helm install acs amrc-connectivity-stack/amrc-connectivity-stack --version ^3.0.0 -f values.yaml --namespace factory-plus --wait --timeout 30m
```

If all went to plan you should now have a fully functioning ACS deployment beginning to deploy to your Kubernetes cluster. Note that it can take a few minutes to have all services operational as the containers are pulled and started.

Take note of the service URLs printed at the end of the installation. You will need these to connect to the various services.

> ACS should be configured once the `service-setup` job has completed successfully. This job is responsible for setting up the initial configuration of the services and can take a few minutes to complete.

### Get the admin password

Get the password for the admin user by running the following command. Note that it may not return the password until the deployment has finished bootstrapping.

```bash
echo $(kubectl get secret admin-password -o jsonpath="{.data.password}" -n {{.Release.Namespace}} | base64 --decode)
```

Once you have the admin password you can connect to the MQTT broker at the URL supplied to you and subscribe to spBv1.0/#. It's advisable to do this before you start adding devices to the system so that you can see all traffic. The bundled [Visualiser](whats-new-in-v3.md#visualiser) is a great tool to view MQTT traffic (plus it's ACS-aware!), or something like MQTTExplorer may be more useful if you're interested in viewing raw packet contents. MQTTExplorer can be downloaded [here](https://mqtt-explorer.com), however building the tool from [this](https://github.com/thomasnordquist/MQTT-Explorer/pull/712) pull request may be more useful when working with ACS and Sparkplug messages.

## Configure your first edge cluster

Next, log into the manager at the URL supplied to you as the `admin` user and create an `Edge Cluster`. This will provide you with a bootstrap script to run on a fresh Kubernetes cluster at the edge. The bootstrap script handles the installation and configuration of all necessary components to connect the edge cluster to the central cluster (see the [Edge Clusters](whats-new-in-v3.md#edge-clusters) section for more information on this process).

Once the edge cluster is connected to the central cluster, it will appear in the Manager UI as a target cluster for Nodes. Create a `Node` under your new Edge Cluster, assigning it to the new edge node, and then create a `Device` within that Node. Configure the device by completing the `Information`, `Connection`, and `Schema` tabs until you see a green `VALID` tag in the top right corner. Once you've configured the device you should see MQTT traffic begin to flow.

## Dashboarding

ACS is much more than just a dashboarding pipeline, but building a simple dashboard is a good way to verify that the architecture is working as expected. Log into Grafana (`grafana.<baseURL>`) with your admin credentials and and create a new dashboard. All ACS data is accessed from the InfluxDB datasource, which will already be configured for you. There are also a number of pre-built dashboards available in the Grafana UI that you can use instantly to start visualising your data.
