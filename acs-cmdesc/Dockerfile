ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG acs_npm=NO

# Install the node application on the build container where we can
# compile the native modules.
RUN install -d -o node -g node /home/node/app \
    && mkdir /home/node/lib
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

FROM ${base_prefix}-js-run:${base_version}

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD node bin/cmdescd.js
