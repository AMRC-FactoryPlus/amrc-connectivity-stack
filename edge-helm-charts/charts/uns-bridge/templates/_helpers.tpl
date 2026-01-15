{{- define "uns-bridge.image" -}}
{{- $root := index . 0 -}}
{{- $key := index . 1 -}}
{{- $image := $root.Values.image -}}
{{- $spec := merge (get $image $key) $image.default -}}
image: "{{ $spec.registry }}/{{ $spec.repository }}:{{ $spec.tag }}"
imagePullPolicy: {{ $spec.pullPolicy }}
{{- end }}

{{- define "uns-bridge.k8sname" }}
    {{- $lc := . | lower }}
    {{- $rp := regexReplaceAllLiteral "[^a-z0-9-]+" $lc "-" }}
    {{- $rp | trimAll "-" }}
{{- end }}

