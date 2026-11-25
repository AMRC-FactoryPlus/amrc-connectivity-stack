/*
 * ACS Data Access Service
 * Build datasets from device, granted on an ISA-95 node
 * Copyright 2026 University of Sheffield
 */

import * as rx from "rxjs";

import { DataAccess as Constants } from "./constants.js";

/* Data Access checks UseDevice ("Build datasets from device") against a
 * device. A grant on an ISA-95 node covers every device placed at or
 * under the node, including devices placed there later, the same as a
 * Read i3X objects grant does in i3X. So a "Device data" grant on a Site
 * gives both halves on every device in the Site.
 *
 * DeviceAuth stands in for the Auth interface everywhere Data Access
 * checks a permission. It answers exactly as Auth does for every other
 * permission and target. */

const USE_DEVICE = Constants.Perm.UseDevice;

export class DeviceAuth {
  /** Construct the stand-in.
   * @arg opts.auth The Auth interface.
   * @arg opts.isa95 An Isa95Hierarchy. */
  constructor (opts) {
    this.auth = opts.auth;
    this.isa95 = opts.isa95;
  }

  get root_principal () { return this.auth.root_principal; }

  resolve_principal (...args) {
    return this.auth.resolve_principal(...args);
  }

  /** As Auth's fetch_acl. UseDevice on a device is also allowed by
   * UseDevice on any ISA-95 node the device sits under. */
  async fetch_acl (principal) {
    const acl = await this.auth.fetch_acl(principal);
    const hierarchy = this.isa95.current;
    return (permission, target, wild) => {
      if (acl(permission, target, wild)) return true;
      if (permission != USE_DEVICE) return false;
      return hierarchy.nodes_of(target).some(n => acl(permission, n, false));
    };
  }

  async check_acl (principal, permission, target, wild) {
    const acl = await this.fetch_acl(principal);
    return acl(permission, target, wild);
  }

  /** As Auth's watch_acl_with_perm. For UseDevice the Set also holds
   * every device placed at or under a granted node, and changes when a
   * device moves. */
  watch_acl_with_perm (principal, permission) {
    const targets = this.auth.watch_acl_with_perm(principal, permission);
    if (permission != USE_DEVICE) return targets;

    return rx.combineLatest([targets, this.isa95.hierarchy]).pipe(
      rx.map(([granted, hierarchy]) => {
        const out = new Set(granted);
        for (const target of granted)
          for (const device of hierarchy.devices_under(target))
            out.add(device);
        return out;
      })
    );
  }
}
