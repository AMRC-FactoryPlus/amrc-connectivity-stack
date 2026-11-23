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
- The host also offers the Manager UI's own actions on the selected
  object, and the app shows them as buttons beside Subscribe: Manage
  access on a device or on an ISA-95 level whose names match the
  vocabulary, and Build dataset on a device. The app asks the host
  `actions({ object, ancestors })` for each object it shows and gets
  `[{ id, label }]` back, and a click calls `runAction(id, selection)`.
  The Manager UI works the actions out again before running one, then
  opens its own access dialog or its dataset builder. Live values come
  from the app's own Subscribe.
- Opened on its own, without the Manager UI around it, the app is
  upstream's web build with nothing changed.

## Changes to upstream files

Every change is marked `ACS` in the source. Apart from these, the new
`src/acs/` folder, the two config files and this file, the copy is
unchanged from upstream. Changes 4 onwards are fixes worth offering
upstream, so they are not tied to the Manager UI.

1. **`src/main.tsx`**: after the runtime config loads, point the
   connection at the host's service (`configureForHost`), and after the
   first render connect (`startHosted`). Both do nothing without a host.
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
   - hide the "i3X Explorer" logo and name at the top left, because the
     Manager UI has its own header. The logo was the way into the About
     dialog, so with a host About is the last entry in the settings
     menu, and its MIT licence and credit are unchanged. Tests in
     `src/acs/toolbarHosted.test.tsx` and `src/acs/toolbar.test.tsx`.
4. **`src/api/subscription.ts`**: read live updates in the shape the
   i3X 1.0 Implementation Guide defines for the stream (Subscribe
   Methods, Streaming, `POST /subscriptions/stream`): a flat array per
   event, `data: [{elementId, value, quality, timestamp}]`, as the
   reference server sends. `{sequenceNumber, updates}` batches belong to
   `/sync`, but upstream read only batches from the stream, so it
   dropped every streamed update without a word. Batches are still read.
   The parsing is now `parseStreamEvent`, with tests.
5. **`src/stores/subscriptions.ts`** and
   **`src/components/subscriptions/SubscriptionTransport.tsx`**: record
   live updates once per animation frame. A feed of 100 updates a
   second per metric otherwise copied the value and trend maps, and
   re-rendered, once per update. The transport buffers deliveries in a
   `FrameBatcher` (`src/stores/frameBatcher.ts`, which falls back to a
   timer in a background tab) and `applyDeliveries` records them in one
   store write, checking each is still wanted at that moment. Each
   element still shows its latest value and keeps every reading for its
   trend, capped at 60 points as before, and a trend point is now
   plotted at the reading's source time, so readings that arrive
   together are not stacked at one arrival time.
6. **`src/components/main/navigation.ts`**, the subscriptions view and
   its rows (`SubscriptionsView.tsx`, `MonitoredItemRow.tsx`), and
   `ObjectDetailView.tsx`: name each monitored element by its full
   path, such as "Site / Line 1 / Spindle speed",
   instead of its name over its element id. The path runs from the top
   of the hierarchy, as the Manager UI writes ISA-95 levels, and a long
   one loses its top levels first so the element's own name stays in
   view. The id is in the tooltip and behind a copy button. Subscribing
   records the path, so a row is named before the catalog holds the
   element, and a component the catalog has not reached yet says
   "Loading name…". `objectPath` and `objectPathSegments` are the shared
   helpers, built on `buildAncestorChain`.
7. **`src/components/tree/treeData.ts`**, `TreeView.tsx`, `TreeNode.tsx`,
   `treeMenu.tsx`, `src/components/search/SearchModal.tsx` and
   `src/stores/explorer.ts`: the tree has two roots, Hierarchy and then
   Schemas. The flat Objects root, which listed every object in the
   catalog at the top level, is gone. The Schemas root is upstream's
   Namespaces root, renamed and moved below Hierarchy; it still lists
   the i3X namespaces with their object and relationship types, so
   nothing about the API or the data changes. An object that is not in
   the Hierarchy (a search result, Back and Forward, or "Reveal in
   Schemas" in a Hierarchy row's menu, which replaces "Reveal in
   Objects") is shown under its type in Schemas (`schemaPathTo`). The
   Hierarchy root loads the catalog when it opens, as the Objects root
   did, so the status bar's object count is unchanged.
8. **`src/components/layout/StatusBar.tsx`**, `MainPanel.tsx`,
   `src/components/main/ModelOverview.tsx`,
   `src/components/details/NamespaceDetail.tsx` and `treeMenu.tsx`:
   i3X namespaces are labelled Schemas wherever the tree's Schemas root
   would otherwise disagree with them: the status bar ("2 schemas"), the
   overview's stat and "Objects by schema" card, the kind under a
   selected namespace's name, its data panel and the tree menu's copy
   entries. Field names from the i3X model, such as "Namespace URI", keep
   their names. Tests in `src/acs/schemaLabels.test.tsx`.
9. **`src/components/layout/Sidebar.tsx`**: the tree panel starts 415px
   wide, not 288px, so a few levels of an ISA-95 path fit without
   dragging it. It is still resizable from 224px to 480px. Upstream keeps
   no width between visits, so neither does this. Test in
   `src/acs/sidebar.test.tsx`.
10. **`src/components/layout/Toolbar.tsx`** and `TreeView.tsx`: the
    Graph Relationships and Component Relationships switches move from
    under the tree's filter box into the settings (gear) menu, as the
    first group of ticked options, styled like "Cache catalog for fast
    reconnects". They set the same store flags as before, so the tree
    behaves the same and, as upstream, the choice lasts for the session.
    The filter box now sits directly above the tree. Tests in
    `src/acs/toolbar.test.tsx` and `TreeNode.test.tsx`.
11. **`src/components/tree/TreeView.tsx`**, `Toolbar.tsx` and
    `src/components/search/SearchModal.tsx`: search starts from the
    tree. The Search button moves from the toolbar to the right of the
    "Filter tree…" box. Typing still filters the tree; Enter in the box,
    or the button, opens the search dialog with the typed text already in
    it (`SearchModal`'s new `initialQuery`). When the filter finds
    nothing among the rows the tree has loaded, a line under the box says
    "Nothing in the visible tree. Press Enter to search.", because search
    looks through the whole catalog. ⌘K still opens an empty search. The
    toolbar still renders the dialog; whether it is open, and with what
    text, is in `src/acs/searchDialog.ts` so the tree can open it. Tests
    in `src/acs/treeSearch.test.tsx`.

7. **The object detail view** (`ObjectDetailView.tsx`,
   `tabs/OverviewTab.tsx`, `tabs/RelationshipsTab.tsx`,
   `graph/RelationshipList.tsx`, `graph/relationshipMenu.tsx`,
   `tree/treeMenu.tsx`, `stores/explorer.ts`), made shorter and quieter:
   - the description sits under the title line, and only when the object
     has one. The Description card and the Object Data panel are gone;
   - Overview runs Current Value, then Relationships, then Identity. The
     Relationships tab is now that panel, on every object, and the
     Subtree tab is gone (`tabs/SubtreeTab.tsx` deleted), with their
     "Open Relationships" and "Open Subtree" menu items. A metric keeps
     History as a tab beside Overview. A container (a composition, or an
     object with children) has no History, so it has no tab bar, and a
     History link onto one lands on Overview;
   - the Current Value of a container lists its children one level down,
     each container among them opening in place to list its own, and a
     click on a name opens that element (`main/ChildValues.tsx`,
     `data/childValues.ts`). i3X 1.0 `maxDepth` recurses through
     HasComponent only and never through HasChildren, so the children
     come from the hierarchy the app holds (the catalog's parentId
     children and the HasChildren and HasComponent edges of
     `/objects/related`), and their values from one batched
     `POST /objects/value` at `maxDepth: 1` per level shown. A newer
     subscription update replaces a child's value. Refresh reads them
     again;
   - the relationship list shows names in full and a UUID type id as its
     last 5 characters, in the muted mono of a readable type id such as
     `isa95-level`, with the full id in the tooltip. The "N direct ·
     right-click a row for more" line and the help line under the map
     are gone, and the map opens on Rings;
   - with a host, the Manager UI's actions (above) sit left of
     Subscribe as outline buttons (`useHostActions` in `src/acs/host.ts`).
     Without a host there are none.

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
3. Apply the changes above again, leaving out any upstream has taken.
   Search the old copy for `ACS` to find them.
4. Update `UPSTREAM_VERSION` in `vite.config.js` from upstream's
   `package.json`, the commit and date at the top of this file, and any
   dependency in `acs-admin/package.json` whose range upstream changed.
   Regenerate both lockfiles.
5. Run `npm test` and `npm run build`, and open the Explorer page.
