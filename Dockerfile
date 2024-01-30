# syntax=docker/dockerfile:1

ARG acs_build=ghcr.io/amrc-factoryplus/utilities-build:v1.3.1
ARG acs_run=ghcr.io/amrc-factoryplus/utilities-run:v1.3.1

FROM ${acs_build} AS build
ARG acs_npm=NO

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

    npm install --save=false
SHELL
COPY --chown=node . .
RUN <<'SHELL'
    git describe --tags --dirty \
        | sed -re's/-[0-9]+-/-/;s/(.*)/export const GIT_VERSION="\1";/' \
        > lib/git-version.js
SHELL

FROM ${acs_run} AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm start
