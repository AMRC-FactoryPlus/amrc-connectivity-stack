
ARG base_version
ARG build_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-manager

FROM --platform=linux/amd64 oven/bun:1.1.29 as build-frontend
WORKDIR /app

COPY package.json bun.lockb .
RUN bun install --immutable --immutable-cache --check-cache

COPY . .
RUN bun run build
RUN rm -rf node_modules

FROM nginxinc/nginx-unprivileged as production-frontend
MAINTAINER Alex Godbehere

# Copy the nginx config
COPY .docker/app/nginx.conf /etc/nginx/nginx.conf

# Copy the application
COPY --from=build-frontend --chown=www:www /app /app

EXPOSE 8080

FROM --platform=linux/amd64 ${base_prefix}:backend-build-${build_version} as build-backend

WORKDIR /app
COPY --from=build-frontend --chown=www-data:www-data /app /app
RUN composer install --prefer-dist --no-dev --optimize-autoloader --no-interaction
RUN php artisan view:cache && php artisan event:cache && php artisan optimize;
RUN composer dump-autoload

FROM --platform=linux/amd64 ${base_prefix}:prod-base-${base_version} as production-backend

MAINTAINER Alex Godbehere
USER www-data
EXPOSE 9000
STOPSIGNAL SIGTERM

# Copy the application
COPY --from=build-backend --chown=www-data:www-data /app /app
