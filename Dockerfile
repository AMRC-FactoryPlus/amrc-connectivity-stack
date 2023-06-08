# syntax=docker/dockerfile:1

ARG acs_base=ghcr.io/amrc-factoryplus/utilities

FROM ${acs_base}-build AS build
ARG acs_npm=NO
RUN install -d -o node -g node /home/node/app
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

RUN apk add git git-daemon

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD npm run git-server
