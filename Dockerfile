FROM node:18-alpine as ts-compiler
WORKDIR /usr/app
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm install
COPY . ./
RUN npm run clean
RUN npm run build

FROM node:18-alpine
WORKDIR /usr/app
COPY --from=ts-compiler /usr/app/package*.json ./
COPY --from=ts-compiler /usr/app/build ./
RUN npm install --only=production
CMD [ "node", "--es-module-specifier-resolution=node", "app.js" ]