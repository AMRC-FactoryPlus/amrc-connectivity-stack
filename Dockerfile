# syntax=docker/dockerfile:1

ARG base_version=v3.0.0
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG revision=unknown

USER root
RUN sh -x <<'SHELL'
    install -d -o node -g node /home/node/app/deploy
SHELL
WORKDIR /home/node/app
USER node
COPY deploy/package*.json deploy/
RUN sh -x <<'SHELL'
    cd deploy
    npm install --save=false
SHELL
COPY --chown=node . .
# Finding schemas would be easier if they were in their own subdir. But
# we can't change that while existing ACS installations rely on the
# current repo structure.
RUN sh -x <<'SHELL'
    cd deploy
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
    node bin/find-schemas.js
SHELL

FROM ${base_prefix}-js-run:${base_version} AS run
# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build /home/node/app/deploy ./
USER node
CMD ["node", "bin/load-schemas.js"]
