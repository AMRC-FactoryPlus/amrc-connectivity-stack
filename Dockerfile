# Use another image to build backend and frontend assets - Base doesn't need composer
FROM ghcr.io/amrc-factoryplus/acs-manager:backend-build-1.0.0 as build-backend

WORKDIR /app
COPY . /app/
RUN composer install --prefer-dist --no-dev --optimize-autoloader --no-interaction
RUN php artisan view:cache && php artisan event:cache && php artisan optimize;
RUN composer dump-autoload

FROM oven/bun:latest as build-frontend
WORKDIR /app
COPY --from=build-backend /app /app

RUN bun install --immutable --immutable-cache --check-cache
RUN bun run build
RUN rm -rf node_modules

FROM ghcr.io/amrc-factoryplus/acs-manager:prod-base-php82-1.0.2 as procuction
MAINTAINER Alex Godbehere

# Copy the application
COPY --from=build-frontend --chown=www:www /app /app

EXPOSE 80

STOPSIGNAL SIGTERM
CMD ["/bin/sh", "-c", "php-fpm -F & nginx -g 'daemon off;'"]
