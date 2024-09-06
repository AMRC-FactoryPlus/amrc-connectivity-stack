{{/*
Define the image for a container.
*/}}
{{- define "edge-cluster.image" -}}
{{- $root := index . 0 -}}
{{- $key := index . 1 -}}
{{- $image := $root.Values.image -}}
{{- $spec := merge (get $image $key) $image.default -}}
image: "{{ $spec.registry }}/{{ $spec.repository }}:{{ $spec.tag }}"
imagePullPolicy: {{ $spec.pullPolicy }}
{{- end }}

