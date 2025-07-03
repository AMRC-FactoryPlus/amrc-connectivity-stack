ARG base_version=latest
FROM ghcr.io/amrc-factoryplus/acs-base-js-build:${base_version} as build

# Install the node application on the build container where we can
# compile the native modules.
RUN install-app acs-opcua-server

FROM ghcr.io/amrc-factoryplus/acs-base-js-run:${base_version}
RUN runuser -u node -g node install-app acs-opcua-server
USER node
EXPOSE 4840
CMD ["node", "bin/opcua-server.js"]
