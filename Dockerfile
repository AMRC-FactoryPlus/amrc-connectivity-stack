ARG utility_prefix=ghcr.io/amrc-factoryplus/utilities
ARG utility_ver=v1.0.7

FROM ${utility_prefix}-build:${utility_ver} AS build

# Install the node application on the build container where we can
# compile the native modules.
RUN install -d -o node -g node /home/node/app
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install --save=false
RUN npm build
COPY . .

FROM ${utility_prefix}-run:${utility_ver}

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

USER node
CMD npm start
