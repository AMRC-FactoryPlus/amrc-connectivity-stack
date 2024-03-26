# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base
ARG revision=unknown

FROM ${base_prefix}-pg-build:${base_version} AS build


# Install the node application on the build container where we can
# compile the native modules.
USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
SHELL
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install --save=false
COPY --chown=node . .
RUN <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM ${base_prefix}-pg-run:${base_version} AS run

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD npm run authn
