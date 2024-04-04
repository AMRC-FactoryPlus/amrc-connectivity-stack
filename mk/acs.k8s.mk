# Makefile rules for automatic K8s deployment

ifndef .acs.k8s.mk
.acs.k8s.mk=1

.PHONY: deploy restart logs

ifdef k8s.deployment

deploy: all restart logs

restart:
	kubectl rollout restart deploy/"${k8s.deployment}"
	kubectl rollout status deploy/"${k8s.deployment}"
	sleep 2

logs:
	kubectl logs -f deploy/"${k8s.deployment}"

else

deploy:
	@: Set k8s.deployment for automatic deployment
	exit 1

endif

# The Makefile for service-setup had logic to run a Job. However it
# required a manifest to create the Job; there isn't any sort of 'job
# template' that can be pushed to k8s and then poked as needed.

endif
