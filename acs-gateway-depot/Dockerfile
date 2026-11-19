# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
USER root
RUN sh -ex <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/
WORKDIR /home/node/app
USER node
COPY --chown=node package*.json ./
RUN sh -ex <<'SHELL'
    touch /home/node/.npmrc
    npm install --save=false --omit=dev --install-links
SHELL
COPY --chown=node . .
# The gateways are amd64. The K3s version and its checksum are pinned in
# gateway/versions.env. We serve the binary to a gateway while it
# installs, so the depot stick does not go out of date.
RUN sh -ex <<'SHELL'
    . ./gateway/versions.env
    mkdir k3s
    wget -O k3s/k3s-amd64 "https://github.com/k3s-io/k3s/releases/download/$(echo "$K3S_VERSION" | sed 's/+/%2B/')/k3s"
    echo "$K3S_SHA256_amd64  k3s/k3s-amd64" | sha256sum -c
SHELL
# Declare this late: changing an ARG reruns every RUN after it
ARG revision=unknown
RUN sh -ex <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM ${base_prefix}-js-run:${base_version} AS run
# openssl makes the admin password hash for the Ubuntu installer.
USER root
RUN apk add --no-cache openssl
WORKDIR /home/node
COPY --from=build /home/node/app ./app/
USER node
WORKDIR /home/node/app
CMD node bin/api.js
