FROM node:lts-alpine

USER node
RUN mkdir -p /home/node/app/node_modules
WORKDIR /home/node/app
COPY . .
RUN npm install --save=false && npx webpack

CMD npm start
