# ACS Manager Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-manager` service satisfies the **Manager** component of the Factory+ framework and provides centralised management of the Sparkplug namespace, configuration of device connections and ensures conformance to Schemas. It also provides a user interface to interact with the Files service.

For more information about the Manager component of Factory+ see the [specification](https://factoryplus.app.amrc.co.uk) or for an example of how to deploy this service see the [AMRC Connectivity Stack repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).

## Local Development

The ACS Manager is based on Laravel 9 and VueJS 2, and therefore a local PHP environment must be configured for local development. See the [Laravel Documentation](https://laravel.com/) for more information on getting started with Laravel.

### Prerequisites
- A local PHP environment like [Laravel Valet](https://laravel.com/docs/10.x/valet) with the KRB5 extension installed
- A local instance of MySQL
- Docker
- Accessible Identity, Authentication & Config Store Factory+ services

### Getting Started
1. Copy `.env.example` to `.env` and replace the variables as appropriate
2. Copy `.env.example` to `.env.testing` and replace the variables as appropriate
3. Run `composer install` to install all PHP dependencies
4. Run `./vendor/bin/sail up` to start ancillary services
5. Run `php artisan key:generate` to set the application key and copy the new `APP_KEY` value from `.env` to `.env.testing`
6. Set the `AUTH_SERVICE_URL`, `CONFIGDB_SERVICE_URL`, `FILE_SERVICE_ENDPOINT` and `CMDESC_SERVICE_ENDPOINT` values in `.env` to values for your environment
7. Edit and run `./get-keytab.sh` to generate a keytab file for the application to use for authentication.
8. Run `php artisan passport:keys` to create the encryption keys for API authentication 
9. Run `yarn` to install frontend dependencies 
10. Run `yarn dev` to launch the frontend server 
11. Serve the application using your web server (see Laravel Valet documentation for an example), ensuring to enable HTTPS (`valet secure` if using Laravel Valet)
12. Run `php artisan schema:import` to import the Schema list from Github
13. Log in using your credentials from your Identity provider
14. Update the `adminstrator` field on your entry in the `users` table to `1`
