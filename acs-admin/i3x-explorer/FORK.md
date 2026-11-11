# i3X Explorer (ACS copy)

An in-tree copy of [i3X Explorer](https://github.com/ace-technologies-inc/i3X-Explorer),
the official client for browsing i3X servers. The Manager UI's Explorer
page shows it, signed in with the Manager UI's own session.

## Where it came from

- Repository `ace-technologies-inc/i3X-Explorer`, commit
  `b51630e3eb247d2033524dfb95add975104eb0bb` (7 November 2026,
  package version `1.1.0-1`).
- Copied: `src/`, `public/`, `index.html`, `tsconfig.json`,
  `tailwind.config.js` and `LICENSE`. Left out: the Electron app
  (`electron/`, `electron-builder.json`), the build, signing and deploy
  scripts, the marketing site (`website/`), and upstream's own Vite,
  Vitest, ESLint and PostCSS configs, which this folder replaces with
  `vite.config.js` and `vitest.config.js`.
- Licence: MIT, in `LICENSE` beside this file. Keep it.

## How the Manager UI uses it

The app is React and the Manager UI is Vue, so it is built on its own
and shown in a same-origin iframe:

- `npm run build` in `acs-admin` builds the Manager UI, then this app
  with `i3x-explorer/vite.config.js` into `dist/i3x-explorer/`. nginx
  serves that folder at `/i3x-explorer/` with its own
  Content-Security-Policy, which lets the Manager UI frame it
  (`.docker/nginx.conf`).
- The iframe keeps the two apps' styles apart. Each has its own Tailwind
  build, and upstream's global styles (its preflight, scrollbars and
  `:root` colours) stay inside the frame.
- `src/pages/Explorer/Explorer.vue` puts a host object on its window
  (`src/lib/i3x-explorer-host.js`) before it creates the frame. The app
  finds it through `window.parent` (`src/acs/host.ts` here). The host
  gives the i3X service URL from the Directory and a Bearer token from
  the service client, so the app connects at start-up with no
  connection dialog and no second sign-in. When i3X refuses the token
  the app asks the host for a new one, naming the refused token, and
  retries once.
- The host also hears which object is selected, so the Manager UI can
  show its own actions above the frame: add to Live Activity, manage
  i3X access, and build a dataset.
- Opened on its own, without the Manager UI around it, the app is
  upstream's web build with nothing changed.

## Changes to upstream files

Every change is marked `ACS` in the source. Apart from these, the new
`src/acs/` folder, the two config files and this file, the copy is
unchanged from upstream.

1. **`src/main.tsx`**: after the runtime config loads, point the
   connection at the host's service (`configureForHost`), and after the
   first render connect and start reporting the selection
   (`startHosted`). Both do nothing without a host.
2. **`src/services/connection.ts`**, `authProviderFor`: with a host,
   return its token provider (`hostAuthProvider`) instead of looking
   for typed-in or OAuth credentials.
3. **`src/components/layout/Toolbar.tsx`**: with a host,
   - hide the server button (which opens the connection dialog) and
     Disconnect, because the Manager UI chooses the server and signs in.
     Connect stays, and reconnects through the host after a failure.
     The status bar still shows the server URL;
   - start in the Manager UI's theme, not the operating system's. The
     theme toggle still works;
   - make New window open the Manager UI's Explorer page, not the bare
     frame.

The first commit on the branch that brought this in has the upstream
files unchanged, so `git diff <that commit> -- i3x-explorer/src` shows
exactly these changes.

## Dependencies

The app's runtime dependencies are in `acs-admin/package.json`, at
upstream's ranges, and in both lockfiles (`package-lock.json` for npm,
`bun.lock` for the Docker build). `@tanstack/react-virtual` is pinned to
the version in upstream's lockfile, `3.14.5`: later versions draw no
rows in upstream's virtualized-list tests under jsdom.

## Running it

From `acs-admin`:

- `npm run build`: the Manager UI and this app.
- `npm test`: the Manager UI's tests, then upstream's tests and ours
  (`src/acs/host.test.ts`) with `i3x-explorer/vitest.config.js`.
- Development: run `npm run dev:i3x-explorer` (port 5174) beside
  `npm run dev`. The Manager UI's dev server sends `/i3x-explorer/` on
  to it.

## Refreshing from upstream

1. Clone upstream at the new commit, and read its commit log for new
   dependencies, new top-level files under `src/` or
   `public/`, and changes to `vite.web.config.ts`.
2. Replace `src/` (keeping `src/acs/`), `public/`, `index.html`,
   `tsconfig.json`, `tailwind.config.js` and `LICENSE` with upstream's.
3. Apply the three changes above again. Each is a few lines; search the
   old copy for `ACS` to find them.
4. Update `UPSTREAM_VERSION` in `vite.config.js` from upstream's
   `package.json`, the commit and date at the top of this file, and any
   dependency in `acs-admin/package.json` whose range upstream changed.
   Regenerate both lockfiles.
5. Run `npm test` and `npm run build`, and open the Explorer page.
