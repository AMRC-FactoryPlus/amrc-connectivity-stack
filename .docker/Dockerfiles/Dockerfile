FROM --platform=linux/amd64 oven/bun:latest as build-frontend
WORKDIR /app
COPY . /app/

RUN bun install --immutable --immutable-cache --check-cache
RUN bun run build
RUN rm -rf node_modules

FROM nginxinc/nginx-unprivileged as production-frontend
MAINTAINER Alex Godbehere

# Copy the nginx config
COPY .docker/app/nginx.conf /etc/nginx/nginx.conf

# Copy the application
COPY --from=build-frontend --chown=www:www /app /app

EXPOSE 8080

FROM --platform=linux/amd64 ghcr.io/amrc-factoryplus/acs-manager:backend-build-1.0.0 as build-backend

WORKDIR /app
COPY --from=build-frontend --chown=www-data:www-data /app /app
RUN composer install --prefer-dist --no-dev --optimize-autoloader --no-interaction
RUN php artisan view:cache && php artisan event:cache && php artisan optimize;
RUN composer dump-autoload

FROM --platform=linux/amd64 ghcr.io/amrc-factoryplus/acs-manager:prod-base-php82-1.0.5 as production-backend
MAINTAINER Alex Godbehere
USER www-data
EXPOSE 9000
STOPSIGNAL SIGTERM

# Copy the application
COPY --from=build-backend --chown=www-data:www-data /app /app
