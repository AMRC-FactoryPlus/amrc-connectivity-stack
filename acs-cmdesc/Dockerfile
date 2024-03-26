ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build

# Install the node application on the build container where we can
# compile the native modules.
RUN install -d -o node -g node /home/node/app
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install --save=false
COPY . .

FROM ${base_prefix}-js-run:${base_version}

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD node bin/cmdescd.js
