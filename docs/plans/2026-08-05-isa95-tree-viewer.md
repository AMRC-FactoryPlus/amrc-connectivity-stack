# ISA-95 tree viewer

## Problem

You have just run "Import from Devices" on a site with a few hundred devices.
The ISA-95 page now has ninety rows in it. Every row is correct in isolation:
a name, a level, a parent, some aliases. What you cannot answer, standing in
front of that table, is the only question you actually have: *is this the
right shape?*

To check whether Factory 2050 has the areas you expect, you filter to Area,
read the parent column, and hold the tree in your head. To check whether
anything got imported twice under a slightly different spelling, you sort by
name and squint. To check whether a node you created last month is doing
anything at all, you cannot: nothing on the page connects a vocabulary node
to the devices that use it.

The same page is what you put on a screen when you are showing someone the
plant model. A ninety-row table filtered to Area is not a plant model. It is
a spreadsheet about a plant model.

Two specific failures the current page cannot show you:

- **A node nothing uses.** Someone created "Assembly Area" during an import
  that was later corrected. It sits in the vocabulary forever, offered in
  every device dropdown, and nothing reports under it.
- **A device that matches nothing.** A device has "Factory2050" typed where
  the vocabulary says "Factory 2050". The dropdown will not have offered
  that, so it came from an older free-text entry or a CSV import. The device
  looks configured. It resolves to nothing.

## Appetite

**Two days.**

## Solution

A second view on the existing ISA-95 page. The table stays and stays default;
a toggle switches to a tree.

### Flow

```
Nav > ISA-95
──────────────────────────────────────────
  [Table | Tree]        [Import from Devices]  [New Node]
        │
        │ (Tree)
        ▼
ISA-95 — Tree
──────────────────────────────────────────
  Filter box

  ▾ AMRC                    Enterprise      12
    ▾ Factory 2050          Site             9
      ▾ MK1                 Area             4
          Robot Cell 1      Work Center      2
          Robot Cell 2      Work Center      2
        Assembly Area       Area             0
    ▸ AMRC Cymru            Site             3
      Orphan Site           Site             0     ← no parent, still shown
  ──────────────────────────────────────
  No hierarchy set                         14
  Doesn't match the vocabulary              3
        │
        │ (click a node)
        ▼
  [existing sidebar, unchanged:
   UUID · Name · Level · Parent · Aliases · Children]
```

### Elements

- **A recursive tree node component.** `ExplorerTreeNode.vue` already does
  chevron expand, depth indent, click-to-select and name filtering in eighty
  lines. Copy its shape. Roots and children come from the ISA-95 store, which
  already has the whole vocabulary in memory and already exposes
  `children_of` and `parents_of`.

- **A device count against every node.** One number: devices resolving at or
  below this node. A zero on a branch is the interesting number, so zeros are
  rendered, not hidden.

- **Two counters at the foot of the tree**, for devices that never reach a
  node: those with no hierarchy at all, and those whose values do not resolve
  into the vocabulary. These are different problems and they get different
  lines.

- **The existing sidebar**, driven by the page's existing `selectedUuid`. The
  tree sets it; nothing else changes.

The tree draws from the vocabulary immediately. Counts arrive as a second
pass once the device store settles, so a large estate never delays the
structure you came to look at.

### Why not the Explorer page

`acs-i3x` already builds an ISA-95 tree, and the Explorer page already
renders it. It is a different tree and it does not answer this problem. It
synthesises nodes from the hierarchy strings devices actually report, so a
configured node with nothing under it does not exist in it, and devices
without a hierarchy are bucketed under `Unknown` rather than flagged. It also
requires `acs-i3x` to be deployed and lazy-loads each level over HTTP, for
data the admin UI already holds entirely in memory.

The distinction is the point. The Explorer tree shows what the plant reports.
This one shows what you configured, and the counts are the join between them.

## Rabbit holes

**Roots are parentless nodes, not Enterprise nodes.** A tree rooted at level
Enterprise silently omits an orphaned Site, which is precisely the defect the
view exists to expose. Any node with no parent renders as a root, carrying its
level badge, so a Site at the top of the tree reads as wrong on sight.

**The vocabulary is a DAG, not a tree.** `parents_of` returns an array, and
nothing in ConfigDB prevents a node being reachable by two paths. The
recursion carries the set of ancestors on the current path; a child already on
that path renders as a non-recursing stub and stops. A legitimately
multi-parented node renders under both parents and its devices count toward
both. That double count is accepted, not corrected.

**Filtering hides matching descendants.** The Explorer's filter hides any node
that does not match, which in a tree hides matching children under
non-matching parents. Here a node shows if it or any descendant matches, and
matching paths auto-expand.

**Expansion state survives re-render.** Both stores are live rxjs
subscriptions, so editing any device anywhere re-emits and re-renders the
tree. Expansion lives in a `Set` of node UUIDs held by the page, keyed by
UUID and never by position.

**The tree opens expanded to Site level.** Fully collapsed is a poor first
impression and useless on a screen share.

**Duplicate the matcher; do not refactor `plan_import`.** The parent-scoped,
alias-aware, case-insensitive matching walk needed to attribute a device to a
node already exists inside `plan_import`, but as a planner: it creates nodes
as a side effect of matching, so it cannot be called for a read-only
question. Add a new pure `resolve_device(device, nodes)` beside it and accept
roughly fifteen duplicated lines. Refactoring working import code shared with
a dialog is not what the second day should be spent on. This is a knowing
trade and it should be revisited if the matcher is needed a third time.

## No-gos

- **No editing from the tree.** No drag to reparent, no add-child in place.
  The existing dialog stays the only way to change the vocabulary.
- **No live data.** No Sparkplug status, no current values, no device health
  in the tree.
- **No fixing the multi-parent bug.** `NewISA95NodeDialog` reads `parents[0]`
  and silently drops the rest on save. Real, out of scope, and the tree will
  make it visible for the first time.
- **No reconciliation with the i3X tree.** No diff view, no "vocabulary vs
  reality" report. The counts hint at the gap; closing it is another pitch.
- **No access changes.** Admin UI only, existing permissions. Nothing here is
  for non-admin viewers.
- **No backend change.** No ConfigDB schema change, no reverse index, no new
  service. Everything runs off data the admin UI already loads.

### Nice-to-have, cut first

Device names listed under the two foot counters, linking through to their
device pages. A device count column on the table view.
