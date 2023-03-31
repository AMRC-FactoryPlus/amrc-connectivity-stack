# ACS Edge Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-edge` service satisfies the **Edge Agent** component of the Factory+ framework and provides edge translation services from end-devices to Factory+ compatible Sparkplug messages, formatted according to the pre-configured schema for the device. The configuration for each specific edge translation application is fetched from the Manager.

For more information about the Edge Agent component of Factory+ see the [specification](https://factoryplus.app.amrc.co.uk) or for an example of how to deploy this service see the [AMRC Connectivity Stack repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).

The general application flow is as follows:

1. The config file is fetched from the Manager
2. A Sparkplug client is created using the credentials and settings in the config file
3. A device connection is instantiated for each provided in the config file.
4. Within each device connection a device is instantiated for each device within the connection configuration which aggregates the sparkplug and device connection instances.
5. Once the sparkplug client is online, the device classes begin polling the physical device connection and any changes are passed to the sparkplug client, which publishes these tags according to the provided settings.
6. Any incoming messages are either handled by the sparkplug edge node, or are routed to the intended device.
7. If the application receives a `Node Control/Reload Translation App Config` NCMD then the application gracefully closes all connections and fetches the new configuration

## Local Development

To run this service locally, ensure that a `.env` file exists in the project root that contains the following environment variables and that `npm install` has been run to install dependencies.

Note that this service relies on a Manager being present in the stack to function as it will pull a real configuration, however the output of the service can be redirected to a local MQTT server by using `MQTT_URL` to prevent interfering with the real namespace.

| Name       | Description                                                                                        | Example                                                 |
|------------|----------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| CONFIG_URL | The endpoint of the manager application where the translator should get its config from            | https://manager.mydomain.com/api/translation_app_config |
| MQTT_URL   | The location of the central Factory+ MQTT service (Can be set to localhost for debugging)          | mqtt://localhost:1883                                   |
| NODE_ID    | The UUID of the node that we're imitating (we'll pull this node's configuration to load)           | 71a6a328-c00e-49ec-9abf-1f072f9d0db4                    |
| keytab     | The keytab/password of the node to authorise the configuration fetch                               | Dgfdd7fds-ffsd742-193Pecmaefimds                        |
| DEBUG      | Whether to print debug information to the console                                                  | true                                                    |
| LOCAL      | Indicates whether the application is running locally to append indication to the MQTT client ID    | true                                                    |
| POLL_INT   | How often the application will check if it has a valid configuration when starting up (in seconds) | 10                                                      |

The service can then be started locally by running:

```bash
npm run clean && npm run build && node --es-module-specifier-resolution=node build/app.js
```

## Contributing

To extend this application, copy `/lib/templates/templateDevice.js` to `lib/devices/` and `/lib/templates/templateDeviceConnection.js` to `/lib/channels/` then rename and customize these two files to your application. Overload any class methods where appropriate. The `deviceConnection` class will require the most custom code in order to abstract the device protocol specific transactions. The `device` class should be able to be reused largely as-is because it only uses the abstracted methods from the `deviceConnection` and `Sparkplug` classes. You will most likely need to add a new constructor method to prepare your device connection for your specific instance.

To trigger your classes to be instantiated, you will need to add a new case for them in the `Translator` class where the config file is being handled.