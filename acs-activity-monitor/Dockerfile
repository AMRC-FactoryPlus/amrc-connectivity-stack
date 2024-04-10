# build stage
FROM oven/bun:latest as build-stage
WORKDIR /app
COPY package*.json ./
RUN bun install --immutable --immutable-cache --check-cache
COPY . /app/
RUN bun run build
RUN rm -rf node_modules

# production stage
FROM nginx:stable-alpine as production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
