# syntax=docker/dockerfile:1
# The line above must be the first line in the file!

ARG acs_build=ghcr.io/amrc-factoryplus/utilities-build:v1.0.8
ARG acs_run=ghcr.io/amrc-factoryplus/utilities-run:v1.0.8

FROM ${acs_build} as ts-compiler
# This ARG must go here, in the image that uses it, or it isn't
# available to the shell scripts. Don't ask me why...
ARG acs_npm=NO
USER root
RUN <<'SHELL'
    apk add git
    install -d -o node /home/node /usr/app
SHELL
USER node
WORKDIR /usr/app
COPY --chown=node . ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        echo "SETTING NPM REGISTRY TO ${acs_npm}" >&2
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi
    npm install --save=false

    git describe --tags --dirty \
        | sed -e's/^/export const GIT_VERSION="/;s/$/";/' \
        > ./lib/git-version.js

    npm run clean
    echo tsc -v
    npm run build
SHELL

FROM ${acs_build} as util-build
USER root
RUN <<'SHELL'
    # Are these necessary?
    apk upgrade --update-cache --available
    apk add openssl
    rm -rf /var/cache/apk/*
    install -d -o node /home/node /usr/app
SHELL
USER node
WORKDIR /usr/app
COPY --chown=node --from=ts-compiler /usr/app/package*.json ./
COPY --chown=node --from=ts-compiler /usr/app/dist ./
COPY --chown=node --from=ts-compiler /home/node/.npmrc /home/node
RUN npm install --save=false --only=production

FROM ${acs_run}
USER root
RUN <<'SHELL'
    apk upgrade --update-cache --available
    apk add openssl
    rm -rf /var/cache/apk/*
SHELL
WORKDIR /usr/app
# This copy leaves the app files owned as root, i.e. read-only to the
# running application. This is a Good Thing.
COPY --from=util-build /usr/app ./
USER node
CMD [ "node", "--es-module-specifier-resolution=node", "bin/ingester.js" ]
