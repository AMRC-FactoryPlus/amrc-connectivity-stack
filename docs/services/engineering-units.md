# Engineering units

A metric's engineering unit is the `Eng_Unit` string in its origin map,
such as `kWh` or `°C`. The Edge Agent publishes it as the Sparkplug
`engUnit` property, the UNS ingester as the `Unit` MQTT property, and
both historians tag each series in InfluxDB with it as `unit`.

The **engineering unit vocabulary** in ConfigDB says which unit each
string means. Each unit is a ConfigDB object with a UNECE
Recommendation 20 code, the symbol metrics write it with, and any
other ways they write it. Metrics keep their strings: the vocabulary
resolves them. This page describes how units are stored, how they are
seeded, how you manage them, and how i3X reports them.

## How it fits together

```
 Units page / service-setup upgrade step
                |
                v
 ConfigDB  Engineering unit app     { code: "KWH", symbol: "kWh", aliases: ["kW·h"] }
                |
                |  eng_unit_resolver()   (lib/js-service-client, shared)
                v
 a metric's Eng_Unit "kWh" or "kW·h"  -->  kilowatt hour, KWH
                |
                +--> i3X object metadata: engUnit "KWH"
                +--> Manager UI: unit picker, Units page counts
```

Nothing about a metric changes on the wire. The vocabulary is read
beside it.

## The vocabulary

Each unit is an object of the **Engineering unit** class
(`255cb8bf-23dc-47f1-b8c9-48c2685b2f6e`), named by its Info config.
Its config in the **Engineering unit** app
(`8cd3bb74-c07f-46ed-8422-3d714c945cce`) is:

```json
{
  "code": "KWH",
  "symbol": "kWh",
  "aliases": ["kW·h"]
}
```

- `code` is the unit's UNECE Recommendation 20 common code. It is the
  unit's identity: i3X reports it, and the unit's object UUID is a v5
  UUID of it (`eng_unit_uuid` in service-client), so the same unit has
  the same UUID on every installation.
- `symbol` is how metrics write the unit. The unit picker writes it
  into new metrics.
- `aliases` are other strings that mean the unit. An existing metric
  written `kW·h` means kilowatt hour once `kW·h` is an alias of it.

A string means a unit if it is the unit's symbol or one of its
aliases, after trimming spaces. Case matters, as it does for units:
`mW` is a milliwatt and `MW` a megawatt.

ConfigDB checks every unit it stores:

- The ConfigSchema checks the shape.
- A special app refuses a code that is not in the UNECE table, an
  object whose UUID is not the one for its code, and a symbol or alias
  that already means another unit. So a string means at most one unit,
  and there is at most one unit per code.

Every principal can read the vocabulary. Administrators change it.

## The UNECE table

`lib/js-service-client/lib/unece-units.js` holds the 1,827 UNECE units
with the display names OPC UA gives them. It is generated from the OPC
Foundation's `UNECE_to_OPCUA.csv` (in `Schema/` of their UA-Nodeset
repository on GitHub); regenerate it with

```
node tools/gen-unece-units.js UNECE_to_OPCUA.csv
```

in `lib/js-service-client`. It is not exported from the library's index,
so browser bundles that don't need it stay small: import
`lib/unece.js` by its path.

`unece_match` in `lib/unece.js` suggests the UNECE unit a string most
likely means. It tries common spellings (`%`, `degC`, `kVAR`, `rpm`),
then OPC UA display names (`kW·h`), then their ASCII forms (`kWh`,
`m3`, `um`). Fourteen display names belong to more than one code in
the OPC UA table, and some of those are mistakes in the table (the
megavar is shown as `kvar`); for each, the code whose description
matches the display name is preferred (`V` is the volt, `VLT`). The
upgrade step and the Units page use it to suggest units; nothing
resolves a metric's unit through it.

## Seeding on install and upgrade

service-setup's step "Seeding the engineering unit vocabulary" runs on
every install and upgrade, after the ISA-95 placements:

1. It collects every `Eng_Unit` in the DeviceInformation origin maps,
   counted by metric, and every `Eng_Unit` default in the schemas.
2. Each string the vocabulary does not resolve yet, and that
   `unece_match` recognises, becomes a unit, or an alias of the unit
   with that code if there is one.
3. A new unit's symbol is the string most used for it on that
   installation, and the OPC UA display name is an alias. So the unit
   picker writes new metrics the way existing ones are written, and
   their series in InfluxDB keep one `unit` tag.
4. If the vocabulary was empty, it also adds a common set of about 60
   units, written with their OPC UA display names (percent is `%`).

It never changes an origin map or a schema, and a second run does
nothing. It logs how many units it created or gave aliases, and every
string it did not recognise, with how many metrics use it:

```
Engineering units: 0 existing, 23 unit strings in use, 60 units created,
0 given aliases, 0 failed, 1 strings not recognised:
"$.transformedReading" (1)
```

## Managing units in the Manager UI

The **Units** page lists every unit with its symbol, name, code,
aliases and how many metrics and devices use it. Select one to edit
its symbol, name and aliases, merge it into another unit, or delete
it.

- **Add Unit** searches the UNECE table by symbol, name or code. A
  unit already in the vocabulary can't be added twice, and a symbol or
  alias that already means another unit is shown before you save.
- **Merge into** makes the merged unit's symbol and aliases aliases of
  the unit you choose, then deletes it. No metric changes; i3X reports
  them with the kept unit's code.
- **Delete** keeps every metric's `Eng_Unit`, but those written with
  the unit get no UNECE code in i3X.

The **Not in the vocabulary** tab lists every string in use that no
unit means, with what it is recognised as:

- **Add as alias of ...** when it is a way of writing a unit already
  there.
- **Add unit ...** when it is a UNECE unit not there yet; the unit is
  written the way the metrics write it.
- **Choose a unit...** when it is not recognised. Pick the unit it
  means and the string becomes one of its aliases. If the string is
  simply wrong, fix the metrics instead.

The unit fields in the origin map editor and the schema editor are
pickers over the vocabulary. A metric whose string no unit means keeps
it, marked "Not in the vocabulary", until you choose a unit. An origin
map CSV import refuses units the vocabulary does not have, apart from
strings the device already uses.

## Engineering units in i3X

An i3X object's metadata (`includeMetadata=true`) has, for a leaf
metric with a unit:

- `engUnit`: the UNECE code of the unit its `Eng_Unit` means, as the
  i3X specification requires. It is left out when the string means no
  unit.
- `system.Eng_Unit`: the string as configured, which is also the
  `unit` tag of its series in InfluxDB.

```json
"metadata": {
  "typeNamespaceUri": "...",
  "sourceTypeId": "metric-number",
  "relationships": { "ComponentOf": "..." },
  "engUnit": "KWH",
  "system": { "Eng_Unit": "kWh" }
}
```

A metric known only from the UNS takes the `Unit` property of its
messages. i3X follows the vocabulary as it changes, and a listing with
metadata gets a new ETag when it does.

## Fixing a metric's unit

Changing a metric's `Eng_Unit` changes the `unit` tag of its series, so
InfluxDB starts a new series for it and its history is split in two.
Do it for units that are wrong, not to tidy their spelling: add the
spelling as an alias instead.
