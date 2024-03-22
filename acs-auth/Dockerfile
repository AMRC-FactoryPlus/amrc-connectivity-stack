# syntax=docker/dockerfile:1

ARG utility_prefix=ghcr.io/amrc-factoryplus/utilities
ARG utility_ver=v1.0.8

FROM ${utility_prefix}-build:${utility_ver} AS build

ARG revision=unknown

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

FROM ${utility_prefix}-run:${utility_ver}

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD npm run authn
