{{- define "edge-agent._image" -}}
image: "{{ .registry }}/{{ .repository }}:{{ .tag }}"
imagePullPolicy: {{ .pullPolicy }}
{{- end }}

{{- define "edge-agent.image" }}
    {{- $root := index . 0 }}
    {{- $image := index . 1 }}
    {{- $images := $root.Values.image }}
    {{- if kindIs "string" $image }}
        {{- include "edge-agent._image" 
            (merge (get $images $image) $images.default) }}
    {{- else }}
        {{- include "edge-agent._image"
            (merge $image $images.default) }}
    {{- end }}
{{- end }}

{{- define "edge-agent.k8sname" }}
    {{- .Values.name | lower | replace "_" "-" }}
{{- end }}

{{- define "edge-agent.sanitize-name" -}}
    {{- . | lower | replace " " "-" | replace "_" "-" 
        | regexFind "[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*"
    }}
{{- end -}}
