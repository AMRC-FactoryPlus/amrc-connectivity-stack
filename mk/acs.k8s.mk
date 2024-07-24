# Makefile rules for automatic K8s deployment

ifndef .acs.k8s.mk
.acs.k8s.mk=1

.PHONY: deploy restart logs

kubectl?=	kubectl
kubectl_args=	
_kubectl=	${kubectl} ${kubectl_args}

ifdef k8s.namespace
kubectl_args+=	-n ${k8s.namespace}
endif

ifdef k8s.kubeconfig
kubectl_args+=	--kubeconfig=${k8s.kubeconfig}
endif

ifdef k8s.deployment

deploy: all restart logs

restart:
	${_kubectl} rollout restart deploy/"${k8s.deployment}"
	${_kubectl} rollout status deploy/"${k8s.deployment}"
	sleep 2

logs:
	${_kubectl} logs -f deploy/"${k8s.deployment}"

else

deploy:
	@: Set k8s.deployment for automatic deployment
	exit 1

endif

# The Makefile for service-setup had logic to run a Job. However it
# required a manifest to create the Job; there isn't any sort of 'job
# template' that can be pushed to k8s and then poked as needed.

endif
