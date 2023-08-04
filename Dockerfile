FROM webdevops/php-nginx:8.1-alpine

# System dependencies
RUN apk add --no-cache autoconf krb5-libs krb5-dev oniguruma-dev postgresql-dev libxml2-dev nodejs yarn gcc make g++ zlib-dev
RUN docker-php-ext-enable redis

ADD https://pecl.php.net/get/krb5-1.1.4.tgz ./
RUN tar -xzf ./krb5-1.1.4.tgz && rm krb5-1.1.4.tgz && cd ./krb5-1.1.4 && phpize && ./configure --with-krb5 --with-krb5kadm && make && make install
RUN echo extension=krb5.so >> /opt/docker/etc/php/php.ini



# Dockerfile configuration
ENV WEB_DOCUMENT_ROOT=/app/public
ENV PHP_DISMOD=bz2,calendar,exiif,ffi,intl,gettext,ldap,mysqli,imap,soap,sockets,sysvmsg,sysvsm,sysvshm,shmop,xsl,zip,gd,apcu,vips,imagick,mongodb,amqp
WORKDIR /app
COPY . .

# PHP & JS dependencies & UI build
RUN composer install --no-interaction --optimize-autoloader --no-dev && rm -rf /root/.composer/cache
RUN yarn
RUN yarn build

# Create and apply permissions for the storage and cache directories
RUN mkdir -p /app/storage/framework/sessions
RUN mkdir -p /app/storage/framework/views
RUN mkdir -p /app/storage/framework/cache
RUN mkdir -p /app/storage/logs
RUN mkdir -p /app/storage/app/purify
RUN mkdir -p /app/storage/app/purify/HTML
RUN mkdir -p /app/storage/app/purify/JSON
RUN chmod -R 775 /app/storage

# Post build activities and optimisation
RUN php artisan route:cache && php artisan view:cache && php artisan event:cache

# Ensure all of our files are owned by the same user and group.
RUN chown -R application:application .

RUN alias pa='php artisan'
