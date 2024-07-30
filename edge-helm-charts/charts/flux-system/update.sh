#!/bin/sh

set -x

rm -f *.yaml

flux install --export >flux-system.yaml

git add .
git commit -v
