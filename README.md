> **Note**
> The AMRC Connectivity Stack is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk/).

This `acs-directory` service satisfies the Directory module component of the Factory+ framework and allows consuming applications to find what devices are currently online. It allows queries to be made asking which devices are publishing what types of data and it allows queries about a device's online/offline history.

# Environment

The `.env.example` file outlines the environment variables that this service expects.

- `HTTP_API_URL` is the URL clients should use to contact the webservice; this will be published over MQTT
- `SPARKPLUG_ADDRESS` is the name of the Sparkplug Node we should publish as
- `POSTGRES_PASSWORD` is the password to use for the superuser on the database


# Service Overview

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

The API is rooted at the path `/v1`, to allow for future incompatible changes.

Devices are identified by UUID, allowing linkage to the config database and potentially other services, and allowing a device to be identified across Sparkplug address changes. If a device birth certificate is published that does not include a device UUID then the directory generates a UUID for each unique Sparkplug address it encounters and records this in a table for future use.

All HTTP access is read-only; only GET requests are supported. Top-level endpoints are:

`/v1/search`
This returns a list of devices known to the directory, information about whether they are currently online and their last-known Sparkplug address. Currently this is all devices that have ever been seen on the network; devices are not expired from the list.

`/v1/device`
This returns information about a particular device; in particular, if an application has a device UUID from somewhere else it allows the device's current Sparkplug address to be retrieved. It is also possible to retrieve the history of a device's presence on the network.

If bad data is received via Sparkplug it will be recorded and returned. In particular, if two devices publish on the same Sparkplug address at the same time the data returned from the directory will be very confusing.

### Authentication & Authorisation
The API requires HTTP Basic authentication on every request. (This means external access MUST be over HTTPS). The credentials required are the client's MQTT server credentials; currently they are checked rather crudely by attempting to connect to the MQTT broker using the supplied credentials (this happens for every request, which is not ideal).

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

`SPARKPLUG_ADDRESS` should be in the format `GROUP-ID/NODE-ID`, and should be set to a well-known address for the directory service.

This MQTT ingestor is an MQTT client that sits watching the network for BIRTH and DEATH requests. It needs permission to subscribe to all BIRTHs and DEATHs. If the ingestor sees a DATA packet from a device it did not believe was online it will attempt to rebirth the device using Factory+ command escalation; it will first delay 5-10s to allow Ignition to send a rebirth if it is going to. (Currently these rebirth requests are mostly ineffective because the CCL system is not able to allow them.)

This is indicative of a more general problem: since we have no reliability mechanism (no STATE support), whenever the directory service goes offline its picture of the network starts to diverge from reality. Missed death certificates are particularly damaging, as they cannot be detected, and will only be resolved when/if the device in question comes back online.

In addition to the metrics required for command escalation, the mqtt component publishes a string metric `Service/Directory` containing the URL configured for clients to use.

## Known issues

- Authenticating every request against the MQTT server is crude and inefficient (if we could maintain the TLS connection and simply send a new CONNECT every time it would not be so bad, but MQTT does not allow that).

- There are no ACLs; all users are provided with all information. It is not clear what the right thing to do is, here.

- There is no mechanism to expire devices that have been permanently removed from the network.

- There is no provision to search starting with a Sparkplug address, beyond querying `/search` and grepping through the results.
