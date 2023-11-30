# syntax=docker/dockerfile:1

ARG acs_build=ghcr.io/amrc-factoryplus/utilities-build:v1.0.8
ARG acs_run=ghcr.io/amrc-factoryplus/utilities-run:v1.0.8

FROM ${acs_build} AS build
ARG acs_npm=NO
RUN install -d -o node -g node /home/node/app
WORKDIR /home/node/app
USER node
COPY --chown=node package*.json ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi
    npm install --save=false
SHELL
COPY --chown=node . .
RUN <<'SHELL'
    git describe --tags --dirty \
        | sed -re's/-[0-9]+-/-/;s/(.*)/export const GIT_VERSION="\1";/' \
        > lib/git-version.js
    rm -rf .git
SHELL

FROM ${acs_run} AS run

RUN apk add git git-daemon

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD npm run git-server
