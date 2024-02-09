# syntax=docker/dockerfile:1

ARG acs_build=ghcr.io/amrc-factoryplus/acs-base-js-build:v0.0.1
ARG acs_run=ghcr.io/amrc-factoryplus/acs-base-js-run:v0.0.1

FROM ${acs_build} AS build
ARG acs_npm=NO
ARG TARGETOS
ARG TARGETARCH

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    apk add git
SHELL
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi

    npm install --save=false --omit=dev
SHELL
COPY --chown=node . .
RUN <<'SHELL'
    git describe --tags --dirty \
        | sed -re's/-[0-9]+-/-/;s/(.*)/export const GIT_VERSION="\1";/' \
        > lib/git-version.js
    rm -rf .git
SHELL

FROM ${acs_run} AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD node bin/edge-monitor.js
