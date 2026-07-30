# Design brief: ACS schema editor

*Hand this to a design agent. It is self-contained; assume no prior
knowledge of ACS or Factory+.*

---

## What this is

The AMRC Connectivity Stack (ACS) connects industrial machines on a
factory floor to a data platform. Before a machine's data can flow,
someone has to describe what that machine measures. That description is
a **schema**.

Today a schema is a hand-written YAML file that only a developer can
produce. We are building a UI so that an engineer who understands the
machine, but does not code, can author one directly. That UI is what you
are designing.

It lives inside `acs-admin`, an existing internal web app.

## Who uses it

Two audiences, design for the less informed one:

- **AMRC engineers.** Understand machines and the Factory+ data model.
  Non-developers. Small in number, internal.
- **Customer and partner engineers.** Deploying ACS at their own site.
  Know their machines intimately, know almost nothing about Factory+.
  This is the audience that decides whether the design works.

Neither will write YAML or use git. Both are competent professionals
using a tool at work, not consumers. They do not need hand-holding, they
need the model to be legible.

## The mental model to convey

A schema is a **tree of things a machine measures**. Four kinds of node,
and these are the only words the UI ever uses:

| Term | What it means |
|---|---|
| **Metric** | One measurement. A spindle speed, a coolant temperature. Has a data type, a unit, a range, documentation. |
| **Component** | Another schema used inside this one. A CNC has a *Device Information* component. |
| **Component list** | Many of the same component, individually named. A CNC has *Spindles*, each one a Spindle component. |
| **Group** | A folder. Organises metrics without meaning anything itself. |

There is a fifth state you must design for but which the user cannot
create: a node the editor does not understand, because the schema was
hand-written and uses a construct the composer does not model. It is
preserved exactly and shown read-only. It must look *safe and
deliberate*, not broken or errored. The user has done nothing wrong.

Underneath, all of this is JSON Schema. **None of that vocabulary may
ever appear in the UI.** No `$ref`, no `allOf`, no `patternProperties`.
If your design surfaces those words, it has failed.

One term needs teaching: "component" is our word for "another schema".
Advanced users need that mapping stated once, where it first appears, in
one short line. Do not build a glossary page.

## The screens

### 1. Schema list

The landing surface. A table of every schema in the deployment.

Each row: name, version, origin, how many devices use it, how many other
schemas reference it. Some rows are marked **superseded** (a newer
version exists). Some are **drafts** (not yet published, invisible to the
rest of the system).

Origin is the important distinction and it drives behaviour everywhere:

- **AMRC library** — shipped with ACS, shared across all deployments.
  Cannot be edited. Editing one makes a local copy.
- **Local** — authored at this site. Editable.
- **Draft** — unfinished, not visible to any machine yet.

Selecting a row opens a detail panel with lineage (what it was forked
from, what supersedes it) and the actions.

Typical scale: 150 to 400 rows. Most are library schemas the user will
never touch. Finding the handful that are theirs matters more than
browsing the rest.

### 2. Schema editor

Two panes. Left: the structure of the schema as a tree. Right: a detail
panel for whatever is selected.

Above them: schema name, version, and whether it is a draft or published.
Actions to add a Metric, Component, Component list or Group. A raw JSON
view as an escape hatch. Save, and Publish.

The tree can nest several levels (groups within groups, components within
groups). Real schemas run to 40 or 50 nodes. Two reserved rows,
`Schema_UUID` and `Instance_UUID`, always appear and are never editable;
they are set by the platform. They currently look like dimmed rows with a
lock, which is functional but not considered.

The detail panel differs by node kind. The metric panel is the busiest:
name, data type (a multi-select over 28 Sparkplug types, usually one or
two chosen), documentation, unit, low and high range, and a record-to-
historian toggle.

### 3. Publish

The most important screen, and the one most worth your attention.

When the user publishes, we compare the draft against what is currently
published and classify every change as **additive** (safe: a metric was
added, documentation improved) or **breaking** (a metric was removed,
renamed, or retyped).

That classification decides what publishing *does*, and the user does not
choose:

- **All additive** → the schema updates in place. Devices are unaffected.
- **Any breaking** → a new version is published under a new identity.
  The old one stays exactly as it is, so nothing under a running machine
  changes. It is marked superseded.

The screen must convey three things at once:

1. **What changed**, as a list, with additive and breaking visually
   separated. A change reads like "Feed_Rate renamed to Feedrate" or
   "Coolant_Temp added".
2. **Who is affected.** Two numbers that mean different things and must
   not be conflated: devices *configured* to use this schema (complete),
   and devices *currently publishing* it (live, a subset, and sometimes
   unknown if the service is unreachable). Design the unknown state.
3. **What is about to happen**, as a consequence of 1, not as a choice.

There is also a blocked state: publishing is refused while the schema
references a component that is itself still a draft. The user needs to
know which one and what to do.

### 4. Fork

A small dialog. Making a local copy of a library schema requires giving
it a new name. The copy starts at version 1 with its own history, which
prevents a collision when AMRC later ships its own version 2.

This is a rule the user did not ask for and will not expect. It needs one
line of justification, no more.

### 5. One existing screen

Devices already have an origin map editor showing which schema they use.
It gains a flag when a newer version of that schema exists. Flag only,
no action. Design the smallest thing that reads as "worth knowing, not
urgent".

## Technical constraints

These are fixed. Work within them.

- **Vue 3**, Options API in pages, `<script setup>` in some components.
- **Tailwind CSS 3**. Utility classes inline. No CSS modules, no styled
  components.
- **shadcn-vue** components built on **reka-ui**, already in the project:
  Button, Input, Dialog, Select, Switch, Badge, Card, Table, Tabs,
  Tooltip, Sidebar, Skeleton, Alert, Collapsible, Popover, Command,
  Breadcrumb. Prefer these over anything new.
- **FontAwesome solid** icons, used as `<i class="fa-solid fa-gauge">`.
  Some **lucide-vue-next** icons also appear. Do not introduce a third
  icon set.
- **vue-sonner** for toasts.
- The app has an existing shell: left nav sidebar, page header with icon
  and title, and a common pattern of a searchable data table with a
  right-hand detail sidebar. New pages should feel like they belong.
- Light theme is what ships. Dark mode classes exist in places but are
  not consistently applied; do not depend on them.

## Copy rules

The existing copy was written to be short and it should stay that way.

- No trailing reassurance. Do not end a sentence with a clause that
  restates its point or tells the user everything will be fine.
- No instructions for something the interface already makes obvious. If
  a button is on screen, do not write a sentence telling them to press
  it.
- Do state the remedy when the user is blocked. "Publish Spindle before
  publishing this schema" earns its place.
- Status lines state what is happening and stop. They do not teach.
- No em dashes.
- Prefer two short sentences that each carry a fact over one sentence
  with a subordinate clause.

Existing strings, as a calibration of length and tone:

> A component is another schema used inside this one.

> This schema comes from the AMRC library. Editing creates a local copy.

> Renaming Feed_Rate breaks the 4 devices using this schema, so this
> publishes as version 2.

> Publish Spindle before publishing this schema.

## What we want from you

Design direction and concrete layouts for the five screens, at a level a
developer can implement without inventing. Specifically:

1. **The publish screen.** How to show a classified change list plus two
   different affect-counts plus a forced outcome, without it reading as a
   wall of warnings. This is the hardest and most valuable piece.
2. **The tree and detail split.** How to make a 50-node tree navigable,
   how reserved and opaque rows should read, and how deep nesting stays
   legible.
3. **The metric panel.** Particularly the 28-value type selector, which
   is currently a wall of small toggle buttons and deserves better.
4. **The list.** How origin and superseded state read at a glance across
   400 rows, most of which are noise to the user.
5. **A short set of conventions** for the feature: how additive versus
   breaking is expressed in colour and type, how draft versus published
   is signalled, how the four node kinds are distinguished.

Please do not redesign the surrounding app shell, and do not change the
four-term vocabulary or the publish rules. Those are load-bearing
decisions made upstream of this brief.

## Reference

The functional implementation exists and can be run for reference. It is
deliberately plain: correct behaviour, unconsidered visuals. Treat it as
a description of the states that must exist, not as a design to refine.
