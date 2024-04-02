# ACS Visualiser component

This visualiser displays live MQTT traffic across the network. It uses
the Factory+ service system to identify devices according to the schema
information they publish.

## Displaying data

In a deployment of ACS the visualiser is served at the `visualiser`
subdomain of your external base domain, so something like
`https://visualiser.my-factoryplus.domain.com`.

The initial login screen requires the URL of the Directory, which will
normally be the `directory` subdomain of the same base domain. This will
be filled in by default but can be changed if needed, or to visualise
other Factory+ installations. The login also requires Factory+
credentials, which need permission to read MQTT traffic and permission
to read the 'Schema icon' ConfigDB Application.

## Configuring icons

The icons displayed for the schemas are pulled from the ConfigDB. They
live under the 'Schema icon' Application, which has UUID
`65c0ccba-151d-48d3-97b4-d0026a811900`. Creating an icon for a new
schema requires these steps.

### Register the schema

Open the ConfigDB editor interface at `https://configdb.DOMAIN/editor`.
Log in with suitable credentials. Under the Objects section, create a
new object with Class UUID `83ee28d4-023e-4c2c-ab86-12c24e86372c`
'Metric Schema' and Object UUID the uuid assigned to the schema. Give
the object a suitable name.

### Create the icon

The icon needs to be created as an SVG with the following restriction:

* The file contains exactly one path.
* This path is filled and not stroked.
* There are no transforms applied to the path.

Freely-avaiable icons are often in this form already. If you have an SVG
which is not in this form it will need editing in a program like
[Inkscape](https://inkscape.org). Removing transforms after editing a
path can require going into Edit / XML Editor and removing the
attributes manually. The document structure wants to be

```xml
<svg:svg>
    <svg:defs/>
    <svg:path/>
</svg>
```

with no other nodes. (Ignore `<sodipodi:>` nodes in Inkscape.) Save the
SVG from Inkscape as 'Plain SVG' without compression.

### Load into ConfigDB

Open the SVG in a text editor. The document needs to look approximately
like this:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>

<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <path d="M64 32C28.7 32 0 60.7 0 96v64c0 35.3 28.7 64 64 64H448c35.3 0
      64-28.7 64-64V96c0-35.3-28.7-64-64-64H64zm280 72a24 24 0 1 1 0 48
      24 24 0 1 1 0-48zm48 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zM64
      288c-35.3 0-64 28.7-64 64v64c0 35.3 28.7 64 64 64H448c35.3 0
      64-28.7 64-64V352c0-35.3-28.7-64-64-64H64zm280 72a24 24 0 1 1 0 48
      24 24 0 1 1 0-48zm56 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z"/>
</svg>
```

Extra attributes on `<svg>` are not important, nor are non-display
elements like `<defs>`. Elements like `<g>` or attributes like
`transform` which introduce a new transform will cause problems and mean
the SVG needs tidying up.

Open the ConfigDB editor interface and open up the 'Schema icon'
Application. If it isn't there create it under Objects with a Class UUID of
Application and an Object UUID of
`65c0ccba-151d-48d3-97b4-d0026a811900`. Create a new config entry using
the UUID of the schema as the Object UUID.

The format of the config entry is

```yaml
bbox:
  left: 0
  top: 0
  width: 512
  height: 512
path: |
  M64 32C28.7 32 0 60.7 0 96v64c0 35.3 28.7 64 64 64H448c35.3 0
  64-28.7 64-64V96c0-35.3-28.7-64-64-64H64zm280 72a24 24 0 1 1 0 48
  24 24 0 1 1 0-48zm48 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zM64
  288c-35.3 0-64 28.7-64 64v64c0 35.3 28.7 64 64 64H448c35.3 0
  64-28.7 64-64V352c0-35.3-28.7-64-64-64H64zm280 72a24 24 0 1 1 0 48
  24 24 0 1 1 0-48zm56 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z
```

(This is given in YAML as supported by the ACS V3 ConfigDB. For ACS v2
the equivalent JSON will be required.) The `bbox` information comes from
the `viewBox` attribute on the `<svg>` element, and the `path` comes
from the `d` attribute of the `<path>`.

### Refresh the visualisation

Once the ConfigDB entries have been created any running instances of the
visualiser will need restarting to pick them up. If entries have been
changed it may also be necessary to clear the browser's cache.
