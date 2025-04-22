{{- define "edge-agent.image" -}}
{{- $root := index . 0 -}}
{{- $key := index . 1 -}}
{{- $image := $root.Values.image -}}
{{- $spec := merge 
        (ternary (get $image $key) $key (kindIs "string" $key))
        $image.default
-}}
image: "{{ $spec.registry }}/{{ $spec.repository }}:{{ $spec.tag }}"
imagePullPolicy: {{ $spec.pullPolicy }}
{{- end }}

{{- define "edge-agent.k8sname" }}
{{- .Values.name | lower | replace "_" "-" }}
{{- end }}

{{- define "edge-agent.sanitize-name" -}}
{{- . | lower | replace " " "-" | replace "_" "-" 
    | regexFind "[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*"
-}}
{{- end -}}
