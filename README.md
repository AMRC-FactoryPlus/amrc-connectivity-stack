# ACS Command Escalation Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-cmdesc` service satisfies the **Command Escalation** component of the Factory+ framework and provides a service that handles Command Escalation requests on behalf of clients. As per Factory+, this service manages escalation requests, authenticating the client, verifying the request is authorised, and actually transmitting the CMD to the device.

For more information about the Command Escalation component of Factory+ see the [specification](https://factoryplus.app.amrc.co.uk) or for an example of how to deploy this service see the [AMRC Connectivity Stack repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).