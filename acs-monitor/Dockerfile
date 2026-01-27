# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG acs_npm=NO
ARG TARGETOS
ARG TARGETARCH

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/

WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    npm install --save=false --omit=dev --install-links
SHELL
COPY --chown=node . .

FROM ${base_prefix}-js-run:${base_version} AS run
ARG revision=unknown
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
# Do this last to not smash the build cache
RUN <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL
USER node
CMD node bin/edge-monitor.js
