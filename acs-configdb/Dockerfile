# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-pg-build:${base_version} AS build

USER root
RUN <<'SHELL'
    set -e
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/

WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    set -e
    touch /home/node/.npmrc
    npm install --save=false --install-links
SHELL
COPY --chown=node . .
# Declare this late: changing an ARG reruns every RUN after it
ARG revision=unknown
RUN <<'SHELL'
    set -e
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM ${base_prefix}-pg-run:${base_version} AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm start
