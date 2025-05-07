# Make variables for OCI images

ifndef .acs.oci.mk
.acs.oci.mk=1

version?=${git.tag}
registry?=ghcr.io/amrc-factoryplus
suffix?=

tag=${version}${suffix}
image=${registry}/${repo}:${tag}

endif
