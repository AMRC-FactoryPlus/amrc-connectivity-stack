# ACS MQTT Service

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-mqtt` service satisfies the **MQTT** component of the Factory+
framework and contains the code to build and run the HiveMQ MQTT server
for Factory+. It contains a git submodule reference to our
[authentication plugin](https://github.com/AMRC-FactoryPlus/hivemq-krb)
for HiveMQ that supports the Factory+ authentication framework.

For more information about the MQTT component of Factory+ see the
[specification](https://factoryplus.app.amrc.co.uk) or for an example of
how to deploy this service see the [AMRC Connectivity Stack
repository](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack).

## Updating the plugin

To pull in a new version of the plugin, check out this repository and
run

    git submodule update --remote

This will pull in the latest version of the plugin. Add and commit the
changed files and push to Github for an automated build.

Alternatively, to build an image by hand, ensure you have a JDK, Maven
and Docker installed. Change directory to `hivemq-krb` and run

    mvn -B package

Copy the file target/hivemq-auth-krb-*-distribution.zip to the parent
directory.

Change back to the parent directory and run

    docker build --build-arg krb_zipfile=hivemq-auth-krb-*-distribution.zip

substituting in the appropriate zipfile.
