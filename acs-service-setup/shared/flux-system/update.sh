#!/bin/sh

set -x

rm -f *.yaml

flux install --export >flux-system.yaml

flux create source helm sealed-secrets \
    --url="https://bitnami-labs.github.io/sealed-secrets" \
    --interval=3h \
    --export >sealed-secrets-repo.yaml
flux create helmrelease sealed-secrets \
    --source=HelmRepository/sealed-secrets \
    --chart=sealed-secrets \
    --interval=3h \
    --target-namespace=sealed-secrets \
    --release-name=sealed-secrets \
    --export >sealed-secrets-release.yaml

git add .
git commit -v
