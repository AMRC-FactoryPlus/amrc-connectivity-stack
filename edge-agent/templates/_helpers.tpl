{{/*
Define the image for a container.
*/}}
{{- define "edge-agent.image" -}}
image: "{{ .registry }}/{{ .repository }}:{{ .tag }}"
imagePullPolicy: {{ .pullPolicy }}
{{- end }}

