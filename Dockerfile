FROM ghcr.io/amrc-factoryplus/utilities-build as ts-compiler
USER root
WORKDIR /usr/app
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm install
COPY . ./
RUN npm run clean
RUN npm run build

FROM ghcr.io/amrc-factoryplus/utilities-build as util-build
USER root
RUN apk upgrade --update-cache --available && \
    apk add openssl && \
    rm -rf /var/cache/apk/*
WORKDIR /usr/app
COPY --from=ts-compiler /usr/app/package*.json ./
COPY --from=ts-compiler /usr/app/build ./
RUN npm install --only=production

FROM ghcr.io/amrc-factoryplus/utilities-run
USER root
RUN apk upgrade --update-cache --available && \
    apk add openssl && \
    rm -rf /var/cache/apk/*
WORKDIR /usr/app
COPY --from=util-build /usr/app ./

CMD [ "node", "--es-module-specifier-resolution=node", "app.js" ]
