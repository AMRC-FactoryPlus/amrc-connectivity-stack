# syntax=docker/dockerfile:1

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

FROM ${base_prefix}-js-build:${base_version} AS build
ARG revision=unknown

USER root
RUN sh -ex <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/

WORKDIR /home/node/app
USER node
COPY --chown=node package*.json ./
RUN sh -ex <<'SHELL'
    touch /home/node/.npmrc
    npm install --save=false --omit=dev --install-links
SHELL
COPY --chown=node . .


FROM ${base_prefix}-js-run:${base_version} AS run

USER root

# Python is only used to parse file formats which have no good JS
# library (e.g. TDMS via nptdms); kept in its own venv so it can't
# shadow anything in the JS runtime image.
RUN apk add --no-cache python3 py3-pip
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir numpy nptdms

# Copy across from the build container.
WORKDIR /home/node
COPY --from=build /home/node/app ./app/
RUN chown -R node:node /home/node/app

USER node
WORKDIR /home/node/app
CMD ["node", "bin/summariser.js"]
