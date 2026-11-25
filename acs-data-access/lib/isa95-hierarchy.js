/*
 * ACS Data Access Service
 * The ISA-95 nodes each device sits under, for grants on a node
 * Copyright 2026 University of Sheffield
 */

import * as rx from "rxjs";

import { DataAccess as Constants } from "./constants.js";

/* A device is placed on one ISA-95 vocabulary node (the Placement app,
 * `{ node }`), and each node lists its children (the Vocabulary app,
 * `{ children }`). A device sits under its own node and every node
 * above it, up to its Enterprise. A grant on any of those nodes covers
 * the device, as it does in i3X. */

/** The nodes above each node: child UUID -> parent UUID.
 * @param vocabulary Node UUID -> vocabulary config, anything that
 * iterates as `[uuid, config]` pairs. */
export function parents_of (vocabulary) {
  const parents = new Map();
  if (!vocabulary) return parents;
  for (const [node, config] of vocabulary) {
    const children = config?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children)
      if (typeof child == "string") parents.set(child, node);
  }
  return parents;
}

/** Where every placed device sits.
 * @param placements Device UUID -> placement config, as `[uuid,
 * config]` pairs.
 * @param vocabulary Node UUID -> vocabulary config, likewise.
 * @returns `{ nodes_of, devices_under }`. `nodes_of(device)` is the
 * device's node and every node above it, nearest first, or an empty
 * list for a device with no placement. `devices_under(node)` is the
 * Set of devices placed at or under the node. */
export function build_hierarchy (placements, vocabulary) {
  const parents = parents_of(vocabulary);
  const above = new Map();
  const under = new Map();

  if (placements) {
    for (const [device, placement] of placements) {
      const node = placement?.node;
      if (typeof node != "string" || node == "") continue;

      /* A vocabulary with a loop must not hang the service. */
      const chain = [];
      const seen = new Set();
      for (let n = node; n != null && !seen.has(n); n = parents.get(n)) {
        seen.add(n);
        chain.push(n);
      }
      above.set(device, chain);
      for (const n of chain) {
        if (!under.has(n)) under.set(n, new Set());
        under.get(n).add(device);
      }
    }
  }

  return {
    nodes_of: device => above.get(device) ?? [],
    devices_under: node => under.get(node) ?? EMPTY,
  };
}

const EMPTY = new Set();

/** The hierarchy before ConfigDB has answered: no device is under any
 * node, so grants on nodes cover nothing until it is known. */
export const NO_HIERARCHY = build_hierarchy(null, null);

export class Isa95Hierarchy {
  /** Construct the hierarchy.
   * @arg opts.cdb A ConfigDB interface.
   * @arg opts.debug The debug logger.
   * @arg opts.placements An Observable of Maps device -> placement.
   * @arg opts.vocabulary An Observable of Maps node -> vocabulary
   * config. */
  constructor (opts) {
    this.log = opts.debug.bound("isa95");

    const placements = opts.placements
      ?? opts.cdb.search_app(Constants.External.ISA95Placement);
    const vocabulary = opts.vocabulary
      ?? opts.cdb.search_app(Constants.External.ISA95Vocabulary);

    /** The current hierarchy, as `build_hierarchy` gives it. Replays
     * the latest to each new subscriber. */
    this.hierarchy = rx.combineLatest([placements, vocabulary]).pipe(
      rx.map(([p, v]) => build_hierarchy(p, v)),
      rx.startWith(NO_HIERARCHY),
      rx.shareReplay(1),
    );

    this.current = NO_HIERARCHY;
  }

  /** Keep `current` up to date for the one-off checks. */
  run () {
    this.hierarchy.subscribe(h => this.current = h);
  }
}
