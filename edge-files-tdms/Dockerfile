# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build

USER root

# Create necessary directories and set correct ownership
RUN install -d -o node -g node /home/node/app \
 && mkdir -p /home/node/lib \
 && chown -R node:node /home/node

COPY --from=lib . /home/node/lib/

# Switch to node user and set working directory
USER node
WORKDIR /home/node/app

# Copy package files and run npm install
COPY --chown=node package*.json ./

RUN touch /home/node/.npmrc \
 && npm install --save=false --omit=dev --install-links

# Copy rest of the application source
COPY --chown=node . .

# Final stage for runtime
FROM ${base_prefix}-js-run:${base_version} AS run

WORKDIR /home/node

# Copy built app from build stage
COPY --from=build /home/node/app ./app/

# ensure node owns the app folder in the final image
RUN chown -R node:node /home/node/app

USER node
WORKDIR /home/node/app

ENV NODE_OPTIONS=--max_old_space_size=2048

CMD ["node", "bin/driver.js"]
