# syntax=docker/dockerfile:1
# The line above must be the first line in the file!

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

ARG acs_build=${base_prefix}-js-build:${base_version}
ARG acs_run=${base_prefix}-js-run:${base_version}

FROM ${acs_build} as ts-compiler
# This ARG must go here, in the image that uses it, or it isn't
# available to the shell scripts. Don't ask me why...
ARG acs_npm=NO
ARG revision=unknown

USER root
RUN <<'SHELL'
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

    echo "export const GIT_VERSION=\"$revision\";" > ./src/git-version.js

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
CMD [ "node", "--es-module-specifier-resolution=node", "app.js" ]
