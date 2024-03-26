ARG base_version

FROM ghcr.io/amrc-factoryplus/acs-base-js-build:${base_version} AS build

# Install the node application on the build container where we can
# compile the native modules.
RUN install -d -o node -g node /home/node/app
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install --save=false
COPY . .

FROM ghcr.io/amrc-factoryplus/acs-base-js-run:${base_version}

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD node bin/cmdescd.js
