# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG acs_npm=NO
ARG revision=unknown
ARG registry=ghcr.io/amrc-factoryplus
ARG tag=latest
ARG pullpolicy=IfNotPresent

USER root
RUN sh -x <<'SHELL'
    install -d -o node -g node /home/node/app
    apk add git
SHELL
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN sh -x <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi

    npm install --save=false
SHELL
COPY --chown=node . .
RUN sh -x <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js

    sed -i -e"s!%%TAG%%!${tag}!g" \
        -e"s!%%REGISTRY%%!${registry}!g" \
        -e"s!%%PULLPOLICY%%!${pullpolicy}!g" \
        charts/edge-agent/values.yaml \
        charts/edge-cluster/values.yaml \

SHELL
FROM ${base_prefix}-js-run:${base_version} AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build /home/node/app ./
USER node
CMD node bin/update.js
