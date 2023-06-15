# syntax=docker/dockerfile:1

ARG acs_base=ghcr.io/amrc-factoryplus/utilities

FROM ${acs_base}-build AS build
ARG acs_npm=NO
ARG kubeseal_version=0.21.0
ARG TARGETOS
ARG TARGETARCH

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
COPY . .

FROM ${acs_base}-run AS run
# Copy across from the build container.
COPY --from=build /usr/local/bin/kubeseal /usr/local/bin/kubeseal
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./
USER node
CMD npm run edge-deploy
