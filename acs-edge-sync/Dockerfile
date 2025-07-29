# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG acs_npm=NO
ARG kubeseal_version=0.21.0
ARG TARGETOS
ARG TARGETARCH
ARG revision=unknown

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
    cd /tmp
    tar="kubeseal-${kubeseal_version}-${TARGETOS}-${TARGETARCH}.tar.gz"
    wget "https://github.com/bitnami-labs/sealed-secrets/releases/download/v${kubeseal_version}/${tar}"
    tar -xvf "${tar}" -C /usr/local/bin kubeseal
SHELL
COPY --from=lib . /home/node/lib/

WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    npm install --save=false --install-links
SHELL
COPY --chown=node . .
RUN <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM ${base_prefix}-js-run:${base_version} AS run
# Copy across from the build container.
COPY --from=build /usr/local/bin/kubeseal /usr/local/bin/kubeseal
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm run start
