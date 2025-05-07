# syntax=docker/dockerfile:1
# The line above must be the first line in the file!

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

ARG acs_build=${base_prefix}-js-build:${base_version}
ARG acs_run=${base_prefix}-js-run:${base_version}

FROM ${acs_build} as ts-compiler
# This ARG must go here, in the image that uses it, or it isn't
# available to the shell scripts. Don't ask me why...
ARG revision=unknown

USER root
RUN <<'SHELL'
    install -d -o node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/
USER node
WORKDIR /home/node/app
COPY --chown=node . ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    npm install --save=false --install-links

    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js

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
    install -d -o node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/
USER node
WORKDIR /home/node/app
COPY --chown=node --from=ts-compiler /home/node/app/package*.json ./
COPY --chown=node --from=ts-compiler /home/node/app/dist ./
COPY --chown=node --from=ts-compiler /home/node/.npmrc /home/node
RUN npm install --save=false --only=production --install-links

FROM ${acs_run}
USER root
RUN <<'SHELL'
    apk upgrade --update-cache --available
    apk add openssl
    rm -rf /var/cache/apk/*
SHELL
WORKDIR /home/node/app
# This copy leaves the app files owned as root, i.e. read-only to the
# running application. This is a Good Thing.
COPY --from=util-build /home/node/app ./
USER node
CMD [ "node", "bin/ingester.js" ]
