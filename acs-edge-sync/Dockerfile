# syntax=docker/dockerfile:1

ARG acs_build=ghcr.io/amrc-factoryplus/utilities-build:v1.3.1
ARG acs_run=ghcr.io/amrc-factoryplus/utilities-run:v1.3.1

FROM ${acs_build} AS build
ARG acs_npm=NO
ARG kubeseal_version=0.21.0
ARG TARGETOS
ARG TARGETARCH
ARG revision=unknown

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    cd /tmp
    tar="kubeseal-${kubeseal_version}-${TARGETOS}-${TARGETARCH}.tar.gz"
    wget "https://github.com/bitnami-labs/sealed-secrets/releases/download/v${kubeseal_version}/${tar}"
    tar -xvf "${tar}" -C /usr/local/bin kubeseal
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
    echo "$revision" > ./lib/git-version.js
SHELL

FROM ${acs_run} AS run
# Copy across from the build container.
COPY --from=build /usr/local/bin/kubeseal /usr/local/bin/kubeseal
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm run start
