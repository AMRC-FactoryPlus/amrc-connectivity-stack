# Sparkplug test fixtures

`payloads/` holds Sparkplug payloads encoded by Eclipse Tahu's JS
library, the encoder ACS edge agents use. Each fixture is a pair:

- `<name>.bin`: the payload bytes, as Tahu's `encodePayload` writes them.
- `<name>.json`: what Tahu's `decodePayload` returns for those bytes.

The Elixir tests decode the `.bin` files and compare the result with the
`.json`, so our decoder is checked against the decoder prod uses.

## Regenerating

The generator lives in `generator/` and pins the versions `acs-edge`
locks: `sparkplug-payload` 1.0.3, `long` 4.0.0 and (by override)
`protobufjs` 6.11.4. The fixtures themselves are defined in
`generator/generate.mjs`.

```sh
cd generator
npm ci
npm run generate
```

Generation is deterministic, so regenerating without changing
`generate.mjs` gives byte-identical files.

## JSON tags

JSON can't hold some of the values Tahu returns, so the generator tags
them:

- A `Long` becomes `{"long": "<decimal>", "unsigned": <bool>}`.
- Bytes become `{"bytes": "<base64>"}`.
- `NaN` and the infinities become `{"float": "NaN"}`, `{"float":
  "Infinity"}` and `{"float": "-Infinity"}`.

## Things the fixtures show

- Tahu JS writes UInt32 to `long_value`, not `int_value`. Our decoder
  has to accept it there.
- Signed integers are two's complement in an unsigned field: Int8 -5
  arrives as 4294967291 in `int_value`.
- Tahu's decode output has no `isNull`; a null metric just has
  `"value": null`.
