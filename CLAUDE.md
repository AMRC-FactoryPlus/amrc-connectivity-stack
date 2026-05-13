# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Parallel-worktree workflow — agent guide

This project uses a lightweight parallel-worktree workflow. When the user
invokes `cw <name>`, Claude Code's `WorktreeCreate` hook runs
`.claude/scripts/worktree-setup.sh`, which creates an isolated git worktree
at `.claude/worktrees/<name>` on a new branch forked from whatever branch
the user currently has checked out. Claude Code then starts inside that
worktree, and you take over.

You should follow the rules below for every session that runs inside a
worktree.

## How to know you're in a worktree

Check whether the current working directory is `.claude/worktrees/<name>/`
(relative to the repo root) and whether `.env.worktree` exists in the cwd.
If yes, you're in a worktree. The file looks like:

```
WORKTREE_NAME=fix-cargo-rounding
WORKTREE_PARENT_BRANCH=main
```

`WORKTREE_PARENT_BRANCH` is the branch the worktree was forked from. **It is
the correct base branch for any PR you open from this worktree.** This is
load-bearing — see the PR base rule below.

## When work is functionally complete: auto-closeout

When the implementation is committed-ready (tests pass, the change works,
the user has reviewed your approach), run the full closeout chain
**without waiting for the user to say "closeout"**. Stopping at "ready for
review, say the word to wrap up" is a bug here.

The chain:

1. **Logical commits.** Unstage everything and re-stage in coherent chunks.
   Each commit should stand alone. Don't dump everything into one commit.

2. **Push the branch.**

3. **Open a PR.** Use the `gh` CLI:

   ```sh
   source .env.worktree
   gh pr create \
     --base "$WORKTREE_PARENT_BRANCH" \
     --title "<short title>" \
     --body-file <tmp>.md
   ```

   The PR body should contain a brief functional summary and a "How to test"
   section. If your team writes release notes / changelog entries, include
   a `## Release notes` section as well — it's the durable place for them.

4. **Print a review walkthrough** to the console as your final assistant
   message. See format below.

5. **Post the same walkthrough as a PR comment:**

   ```sh
   gh pr comment <pr-number> --body-file <tmp>.md
   ```

   Use `--body-file`, not `--body`, so newlines and code fences survive.

6. **Copy a "post this on the ticket" Markdown blob to the clipboard:**

   ```sh
   printf '%s' "$ticket_message" | pbcopy
   ```

   (macOS. On Linux substitute `xclip -selection clipboard` or `wl-copy`.)

   This is a short, plain-English note for the user to paste into whatever
   ticket system they use — what was wrong, what's fixed, anything the
   reporter should re-test. No jargon, no file paths, written for an end
   user. It should be useful when divorced from the PR.

7. **End your response with the teardown command,** so the user can clean
   up when they're satisfied:

   ```sh
   .claude/scripts/worktree-teardown.sh <name>
   ```

   Do **not** run teardown yourself — the user runs it once they've
   confirmed the work is preserved.

## PR base rule (CRITICAL)

`gh pr create` defaults to the repo's default branch (usually `main`).
Worktrees are often forked from in-progress feature branches, so a PR
opened with the default base will silently merge unfinished work to
production.

**Before every `gh pr create`:**

1. Check `.env.worktree` exists in cwd → you're in a worktree.
2. `source .env.worktree` and read `WORKTREE_PARENT_BRANCH`.
3. If set → pass `--base "$WORKTREE_PARENT_BRANCH"`. Do not override even
   if it's not `main`.
4. If unset (older or hand-modified worktree) → ask the user which branch
   to target. Do not silently default to `main`.

If `.env.worktree` is missing entirely (you're in the main checkout, not a
worktree) → use `gh pr create`'s default behaviour.

## Review walkthrough format

Print this directly to the console as your final assistant message. The
same content goes verbatim into the PR comment.

```markdown
# Review: <one-line summary>

**Branch:** `<branch>`
**Worktree:** `.claude/worktrees/<name>`
**PR:** #<num>

## What changed (functional level)

A plain-English summary of the behavioural change. The problem, the fix,
and any judgement calls. Functional, not file-level: describe what the
user/reviewer sees differently, not which functions you touched.

For non-trivial changes, include worked examples with concrete numbers so
the reviewer can sanity-check without recomputing.

## Walkthrough

Group by user-visible feature/area, not by file. ~3–5 bullets per section.

### <Area or feature>
- <What the user/reviewer will see different>
- <Specific decision worth flagging>
- <Edge case handled>

## How to test

Numbered steps the reviewer can follow to verify the change.

1. <Step>
2. <Expected result>
3. ...

## Decisions / open questions

- <Judgement calls worth flagging — alternatives considered, things
  deferred, scope questions>

## Files of note

5–10 most important files touched, grouped by purpose. Not a full diff.
```

### Behaviour rules for the walkthrough

- **The transcript is the artifact.** Do NOT write a `REVIEW.md` or
  `WALKTHROUGH.md` file. The walkthrough lives in the assistant message
  and the PR comment, nowhere else.
- **No emoji ladders.** No "✅ What changed" or "🚀 Tests passing" — keep
  it sober.
- **Same content in console and PR comment.** Don't trim the PR copy down.
- If the walkthrough changes after a course-correction, edit the existing
  PR comment rather than spamming new ones.

## Worktree teardown

Don't run teardown yourself. Surface the command at the end of every
worktree session:

```sh
.claude/scripts/worktree-teardown.sh <name>
```

The teardown script refuses if the worktree has uncommitted changes or
unpushed commits. That's intentional — closeout should have pushed the
branch, so a clean teardown is the signal that closeout completed
successfully.

## When NOT to auto-closeout

If the user is using the worktree for ad-hoc exploration / spike work and
hasn't asked for a PR, don't force one. The auto-closeout rule applies
when there is a definite scoped piece of work and the user expects a PR
out of it. If you're unsure, ask once.

## What this workflow does NOT include

For context, since this is a stripped-down version: there is no Linear
integration, no Discord/chat integration, no per-worktree Docker stack,
no per-worktree database, no per-worktree dev server setup. You are
purely managing git worktrees and the PR/review surface. Don't invent
those integrations or try to find them.

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
