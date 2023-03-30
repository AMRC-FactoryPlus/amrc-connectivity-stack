# ACS Directory Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-directory` service satisfies the **Directory** component of the Factory+ framework and allows consuming applications to find what devices are currently online. It allows queries to be made asking which devices are publishing what types of data and it allows queries about a device's online/offline history.

For more information about the Directory component of Factory+ see the [specification](https://factoryplus.app.amrc.co.uk) or for an example of how to deploy this service see the [AMRC Connectivity Stack repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).

There are three components to this service:

- `database` is a PostgreSQL database keeping the record of device presence and device history
- `webapi` is a node.js web service implementing the REST API. It exposes the REST API directly over HTTP on the assumption that it will be behind a webserver providing HTTPS, similar to how ACS routes requests via Traefik.
- `mqtt` is a node.js MQTT client watching the network and recording device births and deaths to the database. It publishes a Sparkplug birth certificate so that it can participate in Factory+ command escalation, which includes a URL that clients can use to contact the REST API.

## Database

The `database` container is a standard PostgreSQL image. It requires a volume mounted at `/var/lib/postgresql/data` to back the database. On startup, if the volume is empty it will create the database using the environment variable `POSTGRES_PASSWORD` as the superuser password. On subsequent startups that variable will be ignored; the password can then only be changed by accessing the database.

Since this is a single-user database, currently the API connects as the database superuser. When the API first connects it queries the database for a `version` table; if this does not exist it executes DDL to create the database schema. If the version table indicates the database is running an older version of the schema the api executes code to upgrade the database.

## Web API

The `webapi` component listens on port 80 by default. It can be configured with these environment variables (optional variables have defaults in square brackets):

| Variable          | Meaning                                        |
|-------------------|------------------------------------------------|
| PORT              | Port to listen to. [80]                        |
| PGHOST            | Internal hostname of the database server.      |
| PGUSER            | Username for the database server.              |
| POSTGRES_PASSWORD | Password for the database server.              |
| PGDATABASE        | Databse to use on the database server.         |
| MQTT_BROKER       | MQTT broker URL, used for authentication only. |

There are no ACLs currently. Any authenticated client has access to all data. This is subject to further specification.

## MQTT

The `mqtt` component acts as an MQTT/Sparkplug client and records births and deaths in the database. It can be configured with these environment variables (all are required):

| Variable          | Meaning                                        |
|-------------------|------------------------------------------------|
| PGHOST            | Internal hostname of the database server.      |
| PGUSER            | Username for the database server.              |
| POSTGRES_PASSWORD | Password for the database server.              |
| PGDATABASE        | Database to use on the database server.        |
| MQTT_BROKER       | URL of the MQTT broker.                        |
| MQTT_USERNAME     | Username on the MQTT broker.                   |
| MQTT_PASSWORD     | Password on the MQTT broker.                   |
| SPARKPLUG_ADDRESS | Sparkplug node address to publish on.          |
| HTTP_API_URL      | URL to publish for clients to contact the API. |


## Known issues

- There are no ACLs; all users are provided with all information. It is not clear what the right thing to do is, here.
- There is no mechanism to expire devices that have been permanently removed from the network.
- There is no provision to search starting with a Sparkplug address, beyond querying `/search` and grepping through the results.
