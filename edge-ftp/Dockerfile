# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
ARG acs_npm=NO

USER root
RUN <<'SHELL'
    set -e
    install -d -o node -g node /home/node/app
SHELL
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    set -e
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi

    npm install --save=false
SHELL
COPY --chown=node . .
# Declare this late: changing an ARG reruns every RUN after it
ARG revision=unknown
RUN <<'SHELL'
    set -e
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM node:22-alpine AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD node bin/driver.js
