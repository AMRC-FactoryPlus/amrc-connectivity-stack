# build stage
FROM oven/bun:latest as build-stage
WORKDIR /app
COPY package*.json ./
RUN bun install --immutable --immutable-cache --check-cache
RUN sed -i~ -e'/GSS = await/{N;s/\n//}' /app/node_modules/@amrc-factoryplus/service-client/lib/deps.js
COPY . /app/
RUN bun run build
RUN rm -rf node_modules

# production stage
FROM nginx:stable-alpine as production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Echo listen 8080 to a new file /etc/nginx/templates/default.conf.template
RUN mkdir -p /etc/nginx/templates
RUN echo "listen 8080;" > /etc/nginx/templates/default.conf.template

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
