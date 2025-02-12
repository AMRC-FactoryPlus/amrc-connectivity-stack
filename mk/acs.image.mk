
version?=${git.tag}
registry?=ghcr.io/amrc-factoryplus
suffix?=

tag=${version}${suffix}
image=${registry}/${repo}:${tag}

