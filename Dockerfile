# syntax=docker/dockerfile:1

FROM node:lts-alpine

USER node
WORKDIR /home/node/app
COPY --chown=node . .
RUN <<'SHELL'
    npm install --save=false
    npx webpack
SHELL

CMD npm start
