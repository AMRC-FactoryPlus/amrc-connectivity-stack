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
{{- $defaultTag := coalesce 
    $context.image.tag $top.Values.acs.defaultTag $top.Chart.Version }}
{{- $context.image.registry }}/{{ $context.image.repository }}:{{ $defaultTag }}
{{- end }}

{{- define "amrc-connectivity-stack.image" -}}
{{- $top := index . 0 }}
{{- $context := index . 1 }}
image: {{ list $top $context 
    | include "amrc-connectivity-stack.image-name"
    | quote }}
imagePullPolicy: {{ $context.image.pullPolicy }}
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
