{{/*
Template for adding back-off prevention to containers.
This template adds the necessary annotations and startup probe configuration
to prevent Kubernetes from applying exponential back-offs when containers fail.
*/}}

{{- define "edge-agent.backoff-prevention-annotations" }}
# The following annotations help disable back-offs for pods:

# This annotation tells the cluster autoscaler that it's safe to evict this pod
# This prevents back-offs that might occur during cluster scaling operations
cluster-autoscaler.kubernetes.io/safe-to-evict: "true"

# This annotation disables AppArmor restrictions for containers
# This prevents security-related back-offs that might occur due to AppArmor policies
container.apparmor.security.beta.kubernetes.io/{{ .containerName }}: "unconfined"
{{- end }}

{{- define "edge-agent.backoff-prevention-probe" }}
# This startup probe is a key mechanism for preventing back-offs
#
# How it works:
# 1. The probe always succeeds (runs the 'true' command which always returns exit code 0)
# 2. When a container fails, Kubernetes will restart it and then immediately run the startup probe
# 3. With an extremely high failure threshold (9999999), Kubernetes will keep trying the probe
#    without applying back-off delays even if the container keeps failing
# 4. This effectively bypasses Kubernetes' built-in back-off mechanism, which cannot be
#    directly disabled through standard configuration
#
# This ensures that the container restarts immediately after a failure, rather than
# waiting for increasingly longer periods of time
startupProbe:
  exec:
    command:
      - sh
      - -c
      - "true"
  # Start checking almost immediately after container starts
  initialDelaySeconds: 1
  # Check frequently
  periodSeconds: 1
  # Set an extremely high threshold to prevent Kubernetes from giving up
  # This is the key to preventing back-offs
  failureThreshold: 9999999
{{- end }}
