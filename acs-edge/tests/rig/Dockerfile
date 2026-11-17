# syntax=docker/dockerfile:1
#
# ACS Edge Agent
# Split-driver cluster rig: mock devices and the rig's scripts
# Copyright 2026 University of Sheffield
#
# Build from the repository root, because acs-edge needs
# lib/js-service-client:
#
#   docker build -f acs-edge/tests/rig/Dockerfile -t acs-rig-mocks:dev .
#
# This is test support. It is not published with ACS.

FROM node:22-trixie-slim AS build
WORKDIR /w
COPY lib/js-service-client lib/js-service-client
COPY acs-edge/package.json acs-edge/package-lock.json acs-edge/
RUN cd acs-edge && npm install --save=false --install-links --no-audit --no-fund
COPY acs-edge acs-edge
RUN cd acs-edge && npx tsc -p tests/rig

FROM node:22-trixie-slim
WORKDIR /usr/app
COPY --from=build /w/acs-edge/node_modules node_modules
COPY --from=build /w/acs-edge/build/rig build
COPY acs-edge/tests/rig/rig.sh /usr/local/bin/rig
USER node
ENTRYPOINT ["rig"]
