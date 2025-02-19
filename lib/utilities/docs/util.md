# Miscellaneous utilities

These functions are miscellaneous utilities that have been useful when building the services.

## `Version`

```js
import { Version } from "@amrc-factoryplus/utilities";
```

A constant giving the version number of this module.

## `resolve`

```js
path = resolve(meta, file);
```

Locate a file relative to a Javascript module file. The `meta` parameter should be an object returned by `import.meta` for some module loaded from a local file. Returns a local filesystem path.

## `pkgVersion`

```js
version = pkgVersion(meta);
```

Find the `package.json` for the given `import.meta` and return the version.

## `loadJsonObj`

```js
json = loadJsonObj(file);
```

Read a file and parse it as JSON. If there is a JSON parse error then rethrow it including file name information. If the result isn't an object, throw. Return the object.

## `loadAllJson`

```js
objs = loadAllJson(paths);
```

Accepts an array of paths. Ignores paths which do not exist. Paths which refer to directories are expanded to a list of all files in the directory which do not begin with `.`. The resulting list of files is passed through `loadJsonObj` and an array of the objects returned.

This is used for loading bootstrap JSON dumps by the Auth and ConfigDB Factory+ services.