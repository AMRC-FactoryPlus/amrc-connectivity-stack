{{- define "acs.image" -}}
{{- $root := index . 0 -}}
{{- $key := index . 1 -}}
{{- $image := $root.Values.image -}}
{{- $spec := merge (get $image $key) $image.default -}}
image: "{{ $spec.registry }}/{{ $spec.repository }}:{{ $spec.tag }}"
imagePullPolicy: {{ $spec.pullPolicy }}
{{- end }}

{{- define "acs.k8sname" }}
{{- .Values.name | lower | replace "_" "-" }}
{{- end }}
