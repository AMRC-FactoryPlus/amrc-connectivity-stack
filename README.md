# ACS Manager Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-manager` service satisfies the **Manager** component of the Factory+ framework and provides centralised management of the Sparkplug namespace, configuration of device connections and ensures conformance to Schemas. It also provides a user interface to interact with the Files service.

For more information about the Manager component of Factory+ see the [specification](https://factoryplus.app.amrc.co.uk) or for an example of how to deploy this service see the [AMRC Connectivity Stack repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).

## Local Development

The ACS Manager is based on Laravel 9 and VueJS 2, and therefore a local PHP environment must be configured for local development. See the [Laravel Documentation](https://laravel.com/) for more information on getting started with Laravel.

### Prerequisites
- Docker
- Accessible Identity, Authentication & Config Store Factory+ services

### Getting Started
- Copy `.env.example` to `.env` and replace the variables in < > as appropriate for your installation of ACS
- Copy `.env.example` to `.env.testing` and replace the variables in < > as appropriate for your installation of ACS
- Create a `krb5.conf` file in the root of the project containing the kerberos config for your domain
- Create a `k3s.yaml` file in the root of the project containing your kubeconfig for your Kubernetes cluster
- Run `composer install` to install all PHP dependencies
- Run `php artisan key:generate` to set the application key and copy the new `APP_KEY` value from `.env` to `.env.testing`
- Run `./get-keytab.sh` to generate a keytab file for the application to use for authentication
- Run `php artisan passport:keys` to create the encryption keys for API authentication 
- Run `yarn` to install frontend dependencies 
- Run `yarn dev` to launch the frontend server 
- Run `./vendor/bin/sail up` to start the development environment
- Open a new `sh` session in the `backend` container (e.g. `docker exec -it acs-manager-backend-1 sh`)
- Run `php artisan migrate` to run the database migrations
- Head to `localhost:8080` in your browser to view the application
- Log in using your credentials from your Identity provider
- Update the `adminstrator` field on your user in the `users` table to `true`
