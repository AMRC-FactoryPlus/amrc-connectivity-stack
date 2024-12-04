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

k8s.replicas?=	1
_dep=		deploy/"${k8s.deployment}"
ifdef k8s.container
_cont=		-c "${k8s.container}"
endif

deploy: all restart logs

restart:
	${_kubectl} rollout restart ${_dep}
	${_kubectl} rollout status ${_dep}
	sleep 2

logs:
	${_kubectl} logs -f ${_cont} ${_dep}

alllogs:
	${_kubectl} logs -f --all-containers --ignore-errors ${_dep}

down:
	${_kubectl} scale --replicas=0 ${_dep}

up:
	${_kubectl} scale --replicas=${k8s.replicas} ${_dep}

else

deploy:
	@: Set k8s.deployment for automatic deployment
	exit 1

endif

# The Makefile for service-setup had logic to run a Job. However it
# required a manifest to create the Job; there isn't any sort of 'job
# template' that can be pushed to k8s and then poked as needed.

endif
