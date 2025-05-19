# ACS Edge Helm Charts repository

This repository contains Helm Charts deployed automatically to edge
clusters by ACS v3.

Normally an installation of ACS will clone a copy of this repo into its
internal on-prem Git server. From there the edge clusters will pull the
Helm charts using Flux.

Helm charts are made available from the Manager by creating
_Helm chart template_ (`729fe070-5e67-4bc7-94b5-afd75cb42b03`) ConfigDB
entries. It is possible for multiple config entries to reference the
same chart with different configurations. There are several layers of
templating involved.

## Deployment process

When a deployment is created in the Manager (or otherwise), this results
in the creation of an _Edge deployment_
(`f2b9417a-ef7f-421f-b387-bb8183a48cdb`) ConfigDB entry. This is what
actually causes the deployment to be pushed to the edge.

These entries contain:

* `charts`: A chart to deploy. This is a UUID referencing a
  _Helm chart template_ entry.
* `cluster`: The UUID of the cluster to deploy to.
* `hostname`: (optional) The hostname of the machine to deploy to.
* `name`: A string name for the deployment. For Edge Agents this becomes
  the Node name.
* `source`: (optional) The UUID of the Git repository containing the Helm charts.
  If not specified, the default "helm-charts" repository is used.

No other configuration is currently possible at this level (this is not
ideal). These values, along with the UUID of the deployment itself, are
then used to expand `{{templates}}` inside string values in the
referenced _Helm chart template_ entry. The result needs to be an object
with these properties:

* `chart`: The name of the directory in this repo holding the chart to
  deploy.
* `source`: The UUID of the Git repository containing the Helm chart. If not specified,
  the default "helm-charts" repository is used.
* `values`: The Helm `values.yaml` to use for the deployment.

The contents of the `values` object are then used used by Helm to expand
the templates within the chart manifests. Note that the Helm template
language, although superficially similar to the simple `{{template}}`
expansion above, is rather more complicated.

## Creating a new chart template

To deploy an existing chart with different values, start by creating a
new ConfigDB object in the _Helm chart_
(`f9be0334-0ff7-43d3-9d8a-188d3e4d472b`) class. This UUID is what you
will use in the `charts` array of your deployment.

Create a _Helm chart template_ config entry for your new object.
Reference the chart directory with `chart`, and fill in appropriate
default `values`. When looking for a value Helm will default to the
values from the `values.yaml` in the chart directory, and the values in
the chart temlate config entry override those.

You will need to create template strings to explicitly pass through the
values from the deployment into appropriate places in the `values`
entry. Look at the existing entries to see how this works.

## Creating a new chart

Pick a name for the new chart. This needs to be unique and meaningful.
Ideally it doesn't want to conflict with any existing ACS service or
application. This description will use `new-app`.

### Create the chart directory

Create a new directory at the top of this repo named after your chart
name. This directory contains the chart; see [the Helm
documentation](https://helm.sh/docs/topics/charts/) for the format. The
minumum necessary is:

* `Chart.yaml`: A YAML file describing the chart. A minimal example
  would be

```yaml
    apiVersion: v2
    name: new-app
    version: "0.0.1"
    description: "ACS New App deployment"
```

* `values.yaml`: The defaults for the `values` supplied on deployment.
  The structure here is entirely up to you; values in this file, as
  overridden on deployment, are accessible from the `{{ .Values }}`
  variable within the templates.

* `templates`: A directory containing YAML files, with Helm templating,
  which deploy the correct Kubernetes objects.

### Writing the templates

Writing the templates requires some knowledge of the Helm template
language. A certain amount can be picked up by looking at the existing
charts. `helm template .` is a useful command to see what the templates
render to and whether there are templating errors. See the Helm
documentation for how to change the values used for rendering.

The existing charts follow some conventions:

* All objects are explicitly deployed into the `{{ .Release.Namespace
  }}` namespace. This will be the namespace the edge cluster was
  deployed to.

* All objects are given names starting with the chart name and the
  deployment UUID. This avoids conflicts. Often no other name is needed.

* Objects are labelled as follows:

Label|Value
---|---
`factory-plus.app`|Chart name
`factory-plus.nodeUuid`|Deployment UUID
`factory-plus.name`|Name supplied to the deployment

* Pods (including pod templates inside Deployments) need to make sure
  they are deployed to the correct host.

* Where a Service is needed to provide access to a deployed container,
  this should normally have `internalTrafficPolicy: Local`. This will
  only make the Service available on the host the container is running
  on. While this is not a robust security measure it helps.

### Deploying to the correct host

Deploying Pods to the correct host requires two things:

* Setting `nodeSelector`.
* Setting tolerations so that the Pod will deploy to tainted hosts.

Taints are set on certain hosts to avoid floating and infrastructure
pods being deployed there. For example, a Pi might be tainted, or a cell
gateway that is frequently turned off without warning. Deployments
pushed to a specific host need to tolerate these taints or Kubernetes
will refuse to schedule the pod.

Pod templates within Deployments should contain this section:

    {{ if .Values.hostname }}
          nodeSelector:
            kubernetes.io/hostname: {{ .Values.hostname | quote }}
          tolerations:
            - key: factoryplus.app.amrc.co.uk/specialised
              operator: Exists
    {{ end }}

This only sets the toleration for host-specific deployments. This will
require

    values:
      hostname: "{{hostname}}"

in the _Helm chart template_ to pass the hostname through the values
file.

### Deploying the chart to the edge

Once the chart is written, there are several ways to get it deployed to your edge clusters:

* Changes that are accepted into an ACS release will be pushed to all
  installations which are using the default settings. Untested charts
  are unlikely to be accepted into a release.

* Use the multiple chart sources feature to deploy charts from your own Git repository:
  1. Create a Git repository configuration entry in the ConfigDB for your repository
  2. When creating an Edge deployment, specify the `source` field with the UUID of your Git repository
  This approach allows you to maintain your charts separately while still benefiting from
  updates to the core ACS charts.

* Push to a branch on this repo, a clone on public Github, or a clone
  created on your own infrastructure. Change the service-setup config of
  your ACS installation to pull from your new branch/repo. This will
  require adjusting your ACS `values.yaml` and redeploying.

* Clone the edge helm charts repo in your internal ACS git server and
  push to `main` directly. This will stop your internal mirror from
  updating from Github when you upgrade ACS.

To use the last option, clone the repo
`https://git.BASE/git/shared/helm` where `BASE` is your ACS `baseUrl`.
(Use `http` if you have an insecure deployment). Any commit pushed to
`main` on this repo will be deployed to the edge clusters.

When ACS is upgraded the automatic pull performed by service-setup will
update the `acs` branch. If `main` has moved away from `acs` then
service-setup won't update `main`, you will need to merge the changes
manually.

Now create a _Helm chart template_ (see the previous section) so you can
deploy your new chart.
