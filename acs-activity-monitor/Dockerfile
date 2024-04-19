# build stage
FROM oven/bun:latest as build-stage
WORKDIR /app
COPY package*.json ./
RUN bun install --immutable --immutable-cache --check-cache
COPY . /app/
RUN bun run build
RUN rm -rf node_modules

# production stage
FROM node:alpine as production-stage
WORKDIR /app
COPY --from=build-stage /app/dist /app
RUN npm install -g serve
EXPOSE 8080
CMD ["serve", "-s", ".", "-l", "8080"]
