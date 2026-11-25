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
- The Manager UI's URL names the selected object and its detail tab,
  `/explorer?object=<elementId>&tab=history` (Overview is left out),
  so a copied link opens the same object on the same tab.
  `src/acs/hostLocation.ts` calls the host's `setLocation` whenever the
  selection or tab changes, and the Manager UI writes it with
  `router.replace`, so it adds no browser history. At start-up the app
  asks the host's `location()` and, once the catalog holds the object,
  selects it under the hierarchy with the tree opened down to it. The
  host's `onLocationRequest` moves the app when the console's URL
  changes while the page is open (a link followed from elsewhere in the
  console). An object the whole catalog does not hold is left, and the
  URL follows what is shown instead.
- Opened on its own, without the Manager UI around it, the app is
  upstream's web build with nothing changed.

## Changes to upstream files

Every change is marked `ACS` in the source. Apart from these, the new
`src/acs/` folder, the two config files and this file, the copy is
unchanged from upstream. Changes 4 onwards are fixes worth offering
upstream, so they are not tied to the Manager UI.

1. **`src/main.tsx`**: after the runtime config loads, point the
   connection at the host's service (`configureForHost`), and after the
   first render connect (`startHosted`) and keep the Manager UI's URL
   naming the selection (`syncHostLocation`). All do nothing without a
   host.
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

12. **The object detail view** (`ObjectDetailView.tsx`,
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
     again. Each value's timestamp shows as a Date column and a Time
     column, so a value that is days old is visible at a glance;
   - the relationship list shows names in full and a UUID type id as its
     last 5 characters, in the muted mono of a readable type id such as
     `isa95-level`, with the full id in the tooltip. The "N direct ·
     right-click a row for more" line and the help line under the map
     are gone, and the map opens on Rings;
   - with a host, the Manager UI's actions (above) sit left of
     Subscribe as outline buttons (`useHostActions` in `src/acs/host.ts`).
     Without a host there are none.

13. **The subscriptions list** (`SubscriptionsView.tsx`,
    `MonitoredItemRow.tsx`, `src/acs/rowLabel.ts`): a component listed
    under an expanded composition is named by its path below that
    composition, usually only its own name ("Spindle speed", or
    "Axis X / Position" when nested), because the composition's row
    above it already says where it is. A monitored item still shows its
    full path. The element's own name is never cut short: when a row is
    too narrow only the leading names are trimmed, from the left. The
    full path and the element id stay in the tooltip, and the id behind
    the copy button. Tests in `src/acs/rowLabel.test.ts` and
    `SubscriptionsView.test.tsx`.

14. **Trends** (`src/stores/subscriptions.ts`, `TrendView.tsx`,
    `Sparkline.tsx`, `SubscriptionsDrawer.tsx`, `src/acs/trendBuffer.ts`,
    `src/acs/TrendWindowControl.tsx`): a trend keeps every reading since
    subscribing, not the last 60, so a feed of 100 updates a second no
    longer shows one racing second. Each element keeps up to an hour or
    50,000 readings, whichever comes first, dropping the oldest, in two
    parallel `Float64Array`s used as a ring (`TrendBuffer`). A reading is
    still plotted at its source time, or its arrival time without one.
    The graph's time axis runs from the first reading to now by default
    ("All"), so the line squashes as time goes on rather than scrolling.
    "Now" is the newest reading's source time plus how long ago it
    arrived, so a server clock that is off doesn't push the line out of
    view. The panel header chooses the window for every graph in it:
    All, 30 s, 1 min, 5 min, 15 min, 1 h, or the last N readings, kept
    for the browser session (`sessionStorage`). Before drawing, the
    readings in view are reduced to the lowest and highest in each pixel
    column (`downsampleMinMax`), and the graph is as wide as its panel.
    A graph redraws when its own trend changes, which the frame batcher
    limits to once a frame, and once a second to move the axis on. The
    row's sparkline stays the last 60 readings. Tests in
    `src/acs/trendBuffer.test.ts`, `frameBatcher.test.ts` and
    `subscriptions.test.ts`.

15. **Graphs in the subscriptions list** (`MonitoredItemRow.tsx`,
    `SubscriptionsView.tsx`, `TrendView.tsx`, `src/acs/ComponentTrends.tsx`):
    a row opened to its trend draws the graph across the full width of
    the panel, not at a fixed 400px. A composition's row now opens even
    without a value of its own, and shows a graph for each of its
    components that has numeric readings, side by side: as many columns
    of at least 28rem as fit, wrapping onto more rows, and one graph
    alone at full width (`trendGridClass`). Up to 24 are drawn there,
    and the rest are reached through their own rows. Its own value, if
    it has one, follows as before. Tests in
    `src/acs/componentTrends.test.ts` and `SubscriptionsView.test.tsx`.

16. **Live values that keep still** (`MonitoredItemRow.tsx`,
    `ValueChanges.tsx`, `SubscriptionsView.tsx`, `src/stores/subscriptions.ts`,
    `src/acs/heldDecimals.ts`): a value updating 100 times a second
    changed width with every reading, so its delta and sparkline moved
    sideways. Each element now holds the most decimal places it has
    shown since it was subscribed, up to six, and pads with trailing
    zeros (`LiveValue.decimals`), so 1.5 shows as 1.50000 once 1.54571
    has been seen. Integers stay integers, and strings and booleans are
    shown as they come. A delta uses the same places. A numeric metric's
    value and delta sit in right-aligned slots of a set minimum width, so
    the sparkline starts at the same place, and values, deltas, times
    and counters use tabular digits. Tests in
    `src/acs/heldDecimals.test.ts`.

17. **Compositions on servers that deliver only the exact element**
    (`registerItem.ts`, `recovery.ts`, `SubscriptionTransport.tsx`,
    `src/stores/subscriptions.ts`, `src/acs/componentRegistration.ts`):
    a composition is subscribed by registering it with `maxDepth: 0`,
    and the i3X 1.0 Implementation Guide (Subscribe Methods, `POST
    /subscriptions/register`) has the server collect its components'
    changes too. Some servers in use deliver an update only to the exact
    element registered, so a device subscribed that way showed nothing
    while its metrics changed. The app now also registers each component
    on the same subscription with `maxDepth: 1`, in requests of 500,
    after the composition, whose own registration stays. The guide has a
    server accept and ignore a repeated registration, so a server that
    already delivers the components is unaffected. It is best effort: a
    refusal is logged and the composition stays subscribed. Stopping or
    deleting a composition unregisters only the components it added that
    nothing else still needs, so not an item subscribed on its own or a
    component of another running composition, and stopping or deleting
    such an item leaves it registered for that composition. Starting a
    composition again and recovering an expired subscription register
    its components again. An update delivered twice in one batch, with
    the same element, source time and value, is recorded once, so its
    trend and update count don't double. Requests are unchanged in shape.
    Tests in `src/acs/componentRegistration.test.ts`,
    `registerItem.test.ts`, `recovery.test.ts`,
    `SubscriptionTransport.test.tsx` and `frameBatcher.test.ts`.

18. **Popping the subscriptions panel out** (`SubscriptionsDrawer.tsx`,
    `src/components/layout/StatusBar.tsx`, `src/stores/frameBatcher.ts`,
    `src/acs/subscriptionsPopout.ts`): a button in the panel's header
    opens the panel in its own browser window, to keep live values on
    another screen. The frame opens an empty same-origin window
    (`window.open('', …)`) and renders the panel into it with a React
    portal, so it is the same React tree with the same stores and the
    same subscription transport: there is no second connection or
    stream. The window gets copies of the frame's stylesheets and follows
    its theme. While it is out, the drawer is hidden and the status bar
    says "popped out"; clicking that brings the window to the front, and
    its Dock button, the window's own Dock button, or closing the window
    puts the panel back, with keyboard focus on the pop-out button. The
    window closes when the frame goes away. A blocked window leaves the
    panel docked with a short note saying so. Live updates are timed by
    the window's animation frames while it is out, as those keep coming
    when the Explorer's tab is in the background. The choice is kept in
    memory, so it lasts for the visit and a reload starts docked. Tests
    in `src/acs/subscriptionsPopout.test.tsx`.

19. **Subscribing from a row** (`src/acs/useSubscribe.ts`,
    `src/acs/RowSubscribeButton.tsx`, `ObjectDetailView.tsx`,
    `ChildValues.tsx`, `RelationshipList.tsx`, `treeMenu.tsx`,
    `TreeView.tsx`, `SubscriptionTransport.tsx`): a child can be
    subscribed to without opening it. Each row of the Current value table
    has a small Subscribe button in a narrow last column, and each row of
    the relationship list has one beside Focus. Both show on hover or
    focus (always on a screen with no hover), and always show, in the
    success colour, once the element is subscribed, when clicking opens
    the subscriptions drawer. Clicking does not open the element. The
    tree's menu on an object has Subscribe, or Show in subscriptions once
    it is subscribed. The header's Subscribe moved out of
    `ObjectDetailView.tsx` into `useSubscribe.ts` unchanged, so every
    surface behaves the same: it creates a subscription if none is
    active, registers the element (a composition at the whole-tree depth;
    with no value read yet, `registerItem` reads it itself), starts the
    stream unless it is running, opens the drawer, and deletes a
    subscription it created if registering fails. Subscribes now run one
    at a time, so quick clicks on several rows add to one subscription
    rather than each creating its own. A failure shows on the row's
    button (its tooltip and colour) for a few seconds, or at the foot of
    the tree for the menu, and in the header as before.
    `SubscriptionTransport.tsx` gains `useOptionalSubscriptionTransport`,
    which returns null outside the provider, for components rendered on
    their own in tests. Tests in `src/acs/useSubscribe.test.ts` and
    `src/acs/rowSubscribe.test.tsx`.
20. **Subscribing to an ISA-95 level** (`src/acs/levelSubscribe.ts`,
    `src/acs/useSubscribe.ts`): subscribing to a level subscribes to
    the devices under it. i3X 1.0 `maxDepth` recurses through
    HasComponent only, so a registration on a level (which has no value,
    and whose devices are HasChildren, not components) delivers nothing,
    and its row used to sit on "Waiting…" for ever. A level is an object
    of type `isa95-level`, or any other object that is not a composition
    but has children. The Explorer walks down from it through the
    hierarchy it holds, takes the first composition on each branch (a
    device), and subscribes to each one as if it were clicked, at the
    whole-tree depth. A metric that sits in a level outside any device is
    subscribed on its own. With more than 25 to subscribe to it asks
    first, in the Explorer's own dialog (`src/acs/levelConfirm.ts`,
    `LevelConfirmDialog.tsx`, mounted in `src/App.tsx`). It used
    `window.confirm` at first, but a browser that blocks native dialogs
    answers that with no at once, so subscribing to a big level such as
    the enterprise did nothing at all. A level with nothing under it says
    so instead of waiting, and when some fail the rest are still
    subscribed and the failures are listed together. The level itself is not registered, so its button
    does not turn green. Tests in `src/acs/levelSubscribe.test.ts` and
    `src/acs/levelConfirmDialog.test.tsx`.
21. **Subscribing on a site served over plain HTTP**
    (`src/api/client.ts`, `createSubscription`): the client id comes
    from `src/acs/randomUuid.ts` instead of `crypto.randomUUID()`.
    Browsers offer `crypto.randomUUID` only in a secure context (HTTPS
    or localhost), so on an ACS served over plain HTTP every subscribe
    failed with "crypto.randomUUID is not a function". The fallback
    makes a v4 UUID from `crypto.getRandomValues`, which every browser
    offers. Tests in `src/acs/randomUuid.test.ts`.
22. **Engineering units** (`src/acs/engUnit.ts`,
    `src/acs/EngUnitText.tsx`, `ValueDisplay.tsx`, `OverviewTab.tsx`,
    `ChildValues.tsx`, `ObjectDetailView.tsx`, `HistoryTab.tsx`,
    `MonitoredItemRow.tsx`, `ComponentTrends.tsx`,
    `services/catalog.ts`): a metric's unit is shown after its value in
    the Current value panel, in each row of the Current value table and
    the subscriptions table, and in the captions of a composition's
    component trends, and the History tab says "Values in" the unit above
    its chart or table. i3X 1.0 gives the unit as `metadata.engUnit`, a
    UNECE code ("KWH"); ACS's server also gives
    `metadata.system.Eng_Unit`, the string the metric is configured with
    ("kWh"). The Explorer shows that string, with the code in the
    tooltip, and shows the code when a server sends only that. Upstream
    showed neither. The catalog and the related-object batches are listed
    without metadata, so the table rows look their units up: the lookups
    made in one tick go to the server as one `POST /objects/list`, only
    rows with a value ask, an object already held with its metadata
    answers at once, and each unit is cached for five minutes and read
    again when the catalog refreshes. The hook names the shared query
    client, so the subscriptions panel still needs no query provider.
    Tests in `src/acs/engUnit.test.ts` and
    `src/acs/engUnitDisplay.test.tsx`.

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
