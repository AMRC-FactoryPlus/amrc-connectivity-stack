#!/bin/sh

# On Windows try https://frippery.org/busybox/

version="1.0.1"
suffix=""
registry="ghcr.io/amrc-factoryplus"
repo="acs-kerberos-keys"
deployment="NONE"

cd "$(dirname "$(realpath "$0")")"
[ -f config.sh ] && . ./config.sh

tag="${registry}/${repo}:${version}${suffix}"

docker build -t "${tag}" .
docker push "${tag}"

if [ "$deployment" != "NONE" ]
then
    kubectl rollout restart deploy/"$deployment"
    sleep 3
    kubectl logs -f deploy/"$deployment"
fi
