# syntax=docker/dockerfile:1

ARG acs_build=ghcr.io/amrc-factoryplus/utilities-build:v1.0.8
ARG acs_run=ghcr.io/amrc-factoryplus/utilities-run:v1.0.8

FROM ${acs_build} AS build
ARG acs_npm=NO
USER root
RUN sh -ex <<'SHELL'
    apk add git
    install -d -o node -g node /home/node/app
SHELL
WORKDIR /home/node/app
USER node
COPY --chown=node package*.json ./
RUN sh -ex <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi
    npm install --save=false --omit=dev
SHELL
COPY --chown=node . .
RUN sh -ex <<'SHELL'
    git describe --tags --dirty \
        | sed -re's/-[0-9]+-/-/;s/(.*)/export const GIT_VERSION="\1";/' \
        > lib/git-version.js
    rm -rf .git
SHELL

FROM ${acs_run} AS run

RUN apk add git git-daemon

# Copy across from the build container.
WORKDIR /home/node
COPY --from=build /home/node/app ./app/
RUN sh -ex <<'SHELL'
    export HOME=/home/node
    git config --global core.hooksPath /home/node/app/hooks
    chown -R 0:0 .
    chmod -R a=rX .
    chmod a+x app/hooks/post-update
SHELL

USER node
WORKDIR /home/node/app
CMD node bin/git-server.js
