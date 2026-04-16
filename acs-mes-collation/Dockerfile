# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG revision=unknown

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/
RUN <<'SHELL'
    mkdir /home/node/lib/lib
    ln -s /home/node/lib/js-service-client /home/node/lib/lib/js-service-client
    ln -s /home/node/lib/js-rx-util /home/node/lib/lib/js-rx-util
    chown -R node:node /home/node/lib
    chown node:node /home/node/app
SHELL

WORKDIR /home/node/app
USER node

RUN <<'SHELL'
    touch /home/node/.npmrc
    for pkg in js-service-client js-rx-util js-rx-client js-service-api; do
        (cd /home/node/lib/$pkg && npm install --no-save)
    done
SHELL

COPY --chown=node package*.json ./
RUN npm install --no-save
COPY --chown=node . .
RUN echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js

FROM ${base_prefix}-js-run:${base_version} AS run
WORKDIR /home/node/app
COPY --from=build /home/node/lib /home/node/lib
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm start
