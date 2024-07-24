# syntax=docker/dockerfile:1

FROM node:lts-alpine

USER node
WORKDIR /home/node/app
COPY --chown=node . .
RUN <<'SHELL'
    npm install --save=false
    npx webpack
    npx tailwindcss -i ./public/style.css -o ./public/output.css
SHELL

CMD npm start
