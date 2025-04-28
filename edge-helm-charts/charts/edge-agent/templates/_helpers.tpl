{{- define "edge-agent._image" -}}
image: "{{ .registry }}/{{ .repository }}:{{ .tag }}"
imagePullPolicy: "{{ .pullPolicy }}"
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

{{/* Grr this wretched language is awful */}}
{{- define "edge-agent.k8sname" }}
    {{- $lc := . | lower }}
    {{- $rp := regexReplaceAllLiteral "[^a-z0-9-]+" $lc "-" }}
    {{- $rp | trimAll "-" }}
{{- end }}
