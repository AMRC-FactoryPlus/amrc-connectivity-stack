# syntax=docker/dockerfile:1

FROM node:lts-alpine

# The in-tree libraries are supplied as a separate build context
# (--build-context lib=./lib); package.json references them as
# file:../lib/js-* so they land where npm expects.
USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/

USER node
WORKDIR /home/node/app
COPY --chown=node . .
RUN <<'SHELL'
    npm install --save=false --install-links
    npx webpack
    npx tailwindcss -i ./public/style.css -o ./public/output.css
SHELL

CMD npm start
