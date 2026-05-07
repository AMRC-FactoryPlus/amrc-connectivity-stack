# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The AMRC Connectivity Stack (ACS) is a Kubernetes-deployed implementation of the [Factory+](https://factoryplus.app.amrc.co.uk) framework for industrial connectivity and data management. It consists of central cluster services (MQTT broker, Directory, Auth, ConfigDB, Historians, Manager UI) and edge agents that collect data from industrial devices.

## Repository Structure

- `lib/` - Shared libraries (must build first)
  - `js-service-client` - Main client library for Factory+ services
  - `js-service-api` - Base classes for building service APIs
  - `js-edge-driver` - Base driver class for edge translators
  - `js-sparkplug-app` - Sparkplug B protocol utilities
  - `js-pg-client`, `js-rx-client`, `js-rx-util` - Database and reactive utilities
  - `py-edge-driver` - Python edge driver base
  - `java-service-client` - Java client library

- `acs-*` - Central cluster services (Auth, ConfigDB, Directory, etc.)
- `edge-*` - Edge protocol translators (Modbus, BACnet, ADS, etc.)
- `historian-*`, `uns-ingester-*` - Data ingestion services
- `deploy/` - Helm chart for Kubernetes deployment
- `mk/` - Makefile fragments

## JavaScript Services

Most services are ES modules using `@amrc-factoryplus/service-client` for Factory+ integration. Services reference local libraries via `file:../lib/js-*` in package.json.

TypeScript services (like `acs-edge`) use:
```bash
npm run dev    # Development with ts-node-dev
npm run build  # Compile TypeScript
npm run test   # Run Jest tests
```

## Key Patterns

- Services authenticate via Kerberos to the MQTT broker
- Configuration is stored in ConfigDB and accessed via the service client
- Edge agents publish Sparkplug B messages to the MQTT broker
- The `@amrc-factoryplus/service-client` library provides `ServiceClient` class for accessing Factory+ services

## Code Style (JS / TS)

The canonical style for new code is the style used in the core services
written by Ben Morrow: `acs-configdb`, `acs-directory`, `acs-files`, `acs-auth`,
`acs-cmdesc`, and the `lib/js-*` libraries. When writing or modifying code,
match those services - do not invent your own style. Read an existing file
before adding new ones so the style stays consistent.

### Language and modules
- ES modules. JavaScript or TypeScript are both fine - match the existing
  service. Most core services (`acs-configdb`, `acs-auth`, `acs-directory`,
  `acs-files`, `acs-cmdesc`) are plain JS; `acs-edge` is TS.
- `"type": "module"` in package.json. All imports use explicit `.js`
  extensions, including for relative imports (`./foo.js`, not `./foo`) -
  this also applies to TS source, where the import specifier is still `.js`.
- Local libs are pulled in via `file:../lib/js-*` paths.
- If using TS, keep the same shape as the JS services (bin/lib layout,
  same naming conventions, same bootstrap pattern). TS is a tool, not an
  excuse to restructure.

### Formatting
- 4-space indentation. No tabs.
- Double-quoted strings.
- Semicolons **are** used (ASI is not relied on). Look at
  `acs-configdb/lib/api-v1.js` and `lib/notify.js` - statements end with `;`.
- Imports are often visually aligned with extra spaces between the import
  clause and the `from` (e.g. `import * as rx         from "rxjs";`). Match
  the surrounding file - don't reformat existing alignment.
- Space before parens in function/method declarations is common
  (`constructor (opts) {`, `function entry_response (entry) {`). Match the
  file you are editing.
- Single-line `if`/`for` bodies without braces are accepted when the body is a
  single statement; don't add braces just to add them.

### Naming
- `PascalCase` for classes and exported constant maps (`Class`, `Perm`,
  `App`, `BootstrapUUIDs`).
- `snake_case` for methods, functions, locals, and properties
  (`setup_routes`, `fetch_acl`, `is_root`, `resolve_upn`, `mk_res`,
  `entry_response`). Do **not** use `camelCase` for methods - this is the
  most common deviation to avoid.
- `SCREAMING_SNAKE_CASE` for module-level scalar constants
  (`GIT_VERSION`, `Null_UUID`).
- File names are `kebab-case.js` (`api-v1.js`, `git-version.js`,
  `rx-util.js`).

### Service shape
- Layout: `bin/api.js` is the entrypoint, implementation lives in `lib/`.
  No `src/`, no compiled `dist/`.
- Bootstrap pattern (see `acs-configdb/bin/api.js`):
  - top-level `await new RxClient({ env, bootstrap_uuids }).init()`
  - construct collaborators with `new Class({ fplus, ... })`, awaiting
    `.init()` on those that need it
  - hand `routes()` to `new WebAPI({...}).init()` from
    `@amrc-factoryplus/service-api`
  - call `.run()` on the long-running components at the bottom of the file
- Constructors take a single `opts` object and pull fields off it:
  `this.fplus = opts.fplus`. Don't use positional args.
- Loggers come from `opts.fplus.debug.bound("module-name")` (or
  `opts.debug.bound(...)` when fplus isn't passed). Store as `this.log` and
  call as `this.log("message %s %o", a, b)` with printf-style format
  strings.
- Auth: use `fplus.Auth` and `fetch_acl` / `check_acl` patterns from
  `acs-configdb/lib/auth.js`. Do not roll your own.
- Errors inside route handlers: throw `APIError` from
  `@amrc-factoryplus/service-api`; let WebAPI handle the response. Do not
  hand-roll async-handler wrappers.
- UUIDs and other protocol constants live in `lib/constants.js` as
  PascalCase grouped objects, exported individually.

### Reactive code
- `rxjs` is the standard tool for streams and change-notify. Import as
  `import * as rx from "rxjs"` and use `rx.pipe`, `rx.map`, etc. See
  `acs-configdb/lib/notify.js` for the canonical shape.
- `@amrc-factoryplus/rx-util` provides shared operators - prefer these over
  reinventing them.

### Headers
- Each source file starts with a short comment block:
  ```
  /*
   * ACS ConfigDB
   * <one-line file purpose>
   * Copyright <year> University of Sheffield
   */
  ```
  Older files say `Copyright <year> AMRC.` - match the surrounding service.

### When in doubt
Read `acs-configdb/lib/api-v1.js`, `acs-configdb/lib/auth.js`,
`acs-configdb/lib/notify.js`, and `acs-configdb/bin/api.js` before writing a
new service. Copy the shape; do not improvise.

## Contributing

- Branch naming: `initials/branch-description` or `feature/xxx` for long-running branches
- Commit messages: imperative mood, explain the "why", reference issues
- Keep PRs focused on a single issue/feature
- Rebase onto `main` rather than merging
