{{/*
Expand the name of the chart.
*/}}
{{- define "amrc-connectivity-stack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Define the namespace from the values file
*/}}
{{- $namespace := .Release.Namespace }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "amrc-connectivity-stack.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "amrc-connectivity-stack.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Define the image for a container.
*/}}
{{- define "amrc-connectivity-stack.image-name" -}}
{{- $top := index . 0 }}
{{- $context := index . 1 }}
{{- $tag := coalesce 
        $context.image.tag 
        $top.Values.acs.defaultTag 
        (printf "v%s" $top.Chart.Version) }}
{{- $registry := coalesce $context.image.registry $top.Values.acs.defaultRegistry }}
{{- $registry }}/{{ $context.image.repository }}:{{ $tag }}
{{- end }}

{{- define "amrc-connectivity-stack.image" -}}
{{- $top := index . 0 }}
{{- $context := index . 1 }}
{{- $pullp := coalesce $context.image.pullPolicy $top.Values.acs.defaultPullPolicy }}
image: {{ list $top $context 
    | include "amrc-connectivity-stack.image-name"
    | quote }}
imagePullPolicy: {{ $pullp }}
{{- end }}

{{/* Go templates are just awful grrr */}}
{{/* Get a service-specific or default value */}}
{{- define "_acs.with-default" }}
{{- $top := index . 0 }}
{{- $srv := index . 1 }}
{{- $key := index . 2 }}
{{- coalesce (get (get $top.Values $srv) $key) 
    (get $top.Values.acs $key) }}
{{- end }}

{{/*
Specify cache-control max-age for a service.
*/}}
{{- define "amrc-connectivity-stack.cache-max-age" }}
- name: CACHE_MAX_AGE
  value: {{ include "_acs.with-default" (append . "cacheMaxAge") | quote }}
{{- end }}

{{/*
OIDC discovery URL for the Keycloak realm. Included by every F+ service
that runs lib/js-service-api so its auth middleware can fetch the
realm's JWKS and accept Keycloak-issued JWTs. Empty when openid is
disabled: the auth middleware treats an unset OIDC_DISCOVERY_URL as
"no JWT acceptance" and continues to honour Basic/Negotiate/opaque
Bearer unchanged.
*/}}
{{- define "amrc-connectivity-stack.oidc-env" }}
- name: OIDC_DISCOVERY_URL
{{- if .Values.openid.enabled }}
  value: {{ printf "%s/realms/%s/.well-known/openid-configuration"
    (include "amrc-connectivity-stack.external-url" (list . "openid"))
    .Values.openid.realm | quote }}
{{- else }}
  value: ""
{{- end }}
{{- end }}

{{/*
Fetch an external service URL
*/}}
{{- define "amrc-connectivity-stack.external-url" }}
{{- $top := index . 0 }}
{{- $srv := index . 1 }}
{{- $top.Values.acs.secure | ternary "https://" "http://" }}
{{- $srv }}.
{{- $top.Values.acs.baseUrl | required "values.acs.baseUrl is required" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "amrc-connectivity-stack.labels" -}}
helm.sh/chart: {{ include "amrc-connectivity-stack.chart" . }}
{{ include "amrc-connectivity-stack.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "amrc-connectivity-stack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "amrc-connectivity-stack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "amrc-connectivity-stack.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "amrc-connectivity-stack.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Gate a Kerberos client on the KDC being reachable.

The KDC has a long, storage-dependent startup: three initContainers
(chown-storage, kdb-init, the krbkeys bootstrap) plus an RWO PVC to
attach. Every other service fires k5start the moment it is scheduled, so
on a cold boot the whole stack races the KDC. When that race is lost
k5start either dies with "error getting credentials" or blocks, and
because nothing else expresses the dependency the pod never recovers.

The wait is bounded on purpose. An unbounded loop would just move the
hang out of the app container and into init, where it is even less
visible. Exiting non-zero lets Kubernetes restart the pod with backoff,
which is the behaviour we actually want.

Note this proves the KDC is accepting connections, not that it can issue
tickets for a given principal - a full check would need the caller's
keytab plumbed in here. Port 88 is the Service port (targetPort 8888).
*/}}
{{- define "amrc-connectivity-stack.wait-for-kdc" }}
{{- $top := . -}}
- name: wait-for-kdc
{{ include "amrc-connectivity-stack.image" (list $top $top.Values.shell) | indent 2 }}
  command: ["/bin/sh", "-c"]
  args:
    - |
      attempts={{ $top.Values.acs.kdcWait.attempts }}
      interval={{ $top.Values.acs.kdcWait.interval }}
      n=0
      until nc -z kdc.{{ $top.Release.Namespace }}.svc.cluster.local 88; do
          n=$((n + 1))
          if [ "$n" -ge "$attempts" ]; then
              echo "KDC still unreachable after $n attempts, giving up"
              exit 1
          fi
          echo "Waiting for KDC ($n/$attempts)"
          sleep "$interval"
      done
      echo "KDC is reachable"
{{- end }}

{{/*
Liveness/readiness/startup probes for a service that listens on a port.

These are deliberately tcpSocket probes and not httpGet /ping. WebAPI
registers /ping after auth.setup() installs a global auth middleware, and
no service sets the `public` bypass, so /ping answers 401 without
Kerberos credentials - a kubelet probe would read that as a hard failure.
A tcpSocket probe also matches the failure we are guarding against: when
k5start never hands over to the application, nothing ever binds the port.

The startupProbe is load-bearing. Some of these services run a database
migration before they listen, and a bare livenessProbe would trade a
silent wedge for a restart loop that never converges.

Takes (list $top <port>).
*/}}
{{- define "amrc-connectivity-stack.service-probes" }}
{{- $top := index . 0 }}
{{- $port := index . 1 }}
{{- $p := $top.Values.acs.probes -}}
startupProbe:
  tcpSocket:
    port: {{ $port }}
  periodSeconds: {{ $p.startup.periodSeconds }}
  failureThreshold: {{ $p.startup.failureThreshold }}
readinessProbe:
  tcpSocket:
    port: {{ $port }}
  periodSeconds: {{ $p.readiness.periodSeconds }}
  failureThreshold: {{ $p.readiness.failureThreshold }}
livenessProbe:
  tcpSocket:
    port: {{ $port }}
  periodSeconds: {{ $p.liveness.periodSeconds }}
  failureThreshold: {{ $p.liveness.failureThreshold }}
{{- end }}
