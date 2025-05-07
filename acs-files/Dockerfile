# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG revision=unknown

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


FROM ${base_prefix}-js-run:${base_version} AS run

# Copy across from the build container.
WORKDIR /home/node
COPY --from=build /home/node/app ./app/


USER node
WORKDIR /home/node/app
CMD node bin/api.js
