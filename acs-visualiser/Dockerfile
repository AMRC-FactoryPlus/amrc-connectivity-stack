# syntax=docker/dockerfile:1

FROM node:lts-alpine

# The in-tree libraries are supplied as a separate build context
# (--build-context lib=./lib); package.json references them as
# file:../lib/js-* so they land where npm expects.
USER root
RUN <<'SHELL'
    set -e
    install -d -o node -g node /home/node/app
    mkdir /home/node/lib
SHELL
COPY --from=lib . /home/node/lib/

USER node
WORKDIR /home/node/app
COPY --chown=node . .
# Without set -e a failed webpack build still produces an image, with
# a bundle that throws in the browser.
RUN <<'SHELL'
    set -e
    npm install --save=false --install-links
    npx webpack
    npx tailwindcss -i ./public/style.css -o ./public/output.css
SHELL

CMD npm start
