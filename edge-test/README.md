# edge-test: ACS testing driver

An Edge Agent driver that makes up its data. Each address is
`function:period:amplitude:packing`, such as `sin:3000:50:bd`:

- `function` is `sin`, `saw` or `const`
- `period` is in milliseconds and `amplitude` is the peak value
- `packing` is `bd` or `ld` for a big-endian or little-endian double,
  or `bf` or `lf` for a float

The driver answers each poll with the packed value, so a metric's path
is `0`.

## Edge Scout

The driver lists a made-up tree of addresses when an operator presses
Scan. The tree depends only on the scan options, so every scan with
the same options lists the same items with the same ids. That makes the
driver the test fixture for the Edge Agent and the Admin UI.

Value `i` (counting from 0) has an address made from its number, such
as `sin:1000:1:bd` for value 0 and `saw:1013:4:ld` for value 13. Its
id is its address. Each folder splits its values into up to 4
sub-folders, until `depth` levels, and a folder with no values is left
out. Folder ids are `f/` and the position of the folder at each level,
counting from 0, such as `f/2/1`. A scan with `root` set to a folder id
lists that folder.

Option|Default|What it does
---|---|---
`size`|100|How many values to list, up to 1,000,000
`depth`|2|How many folder levels to put them in, up to 32. With 0 the values are at the top
`delay_ms`|0|How long the device takes to answer each folder listing, up to 60,000
`duplicates`|false|Send the first 10 values a second time, which the Edge Agent drops
`fail`|none|End the scan with this code: `OPTIONS`, `CONN`, `AUTH`, `ERR` or `UNSUPPORTED`
`hang`|false|Stop sending and never return, so the scan ends at its time limit
`after`|0|How many items to list before `fail` or `hang` takes effect

An unknown option, or a `root` that is not a folder of the tree, ends
the scan with `OPTIONS`.

Set the environment variable `SCOUT_UNSUPPORTED=1` to make the driver
answer that it can't scan or read, for testing the Edge Agent's
`UNSUPPORTED` and `NOREADS` answers against a real driver.

## Live values

The driver answers the Edge Agent's reads with a value that depends
only on the address: each address's function a quarter of a period in.
So `sin:4000:50:bd` reads `50`, `saw:1000:8:lf` reads `2` and
`const:1000:2.5:ld` reads `2.5`, with type `Double` or `Float` from the
packing. An address that is not a test address reads as the error "Not
a test address".

Reads have no options of their own, so these keys in the connection's
driver configuration control them:

Key|Effect
---|---
`read_fail`|A library code, such as `CONN` or `ERR`. Every read ends with it
`read_hang`|`true` makes every read go unanswered, so the library gives up after 4 s and the Edge Agent records `TIMEOUT`

## Development

```sh
npm install
npm test
```

The tests read the schemas in `lib/edge-scout-schemas` by relative
path, and the driver library comes from `lib/js-edge-driver`.
