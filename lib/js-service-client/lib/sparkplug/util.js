/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import Long from 'long'

/* Number.MAX_SAFE_INTEGER is well above the input Date will accept;
 * this is past the year 100000. */
export function long_to_date (ts) {
    const val = Long.isLong(ts) ? ts.toNumber() : ts;
    return new Date(val);
}

/** Remove Longs from a decoded Sparkplug packet.
 * This translates timestamps to Dates and aliases to BigInts. Values
 * which have decoded as Longs will also be converted to BigInts. This
 * does not attempt to handle templates or properties as we don't
 * currently use these.
 *
 * Edits `packet` in place and returns the result.
 */
export function sp_remove_longs (packet) {
    if ("timestamp" in packet)
        packet.timestamp = long_to_date(packet.timestamp);
    for (const m of packet.metrics ?? []) {
        if ("alias" in m)
            m.alias = BigInt(m.alias);
        if ("timestamp" in m)
            m.timestamp = long_to_date(m.timestamp);
        if (Long.isLong(m.value))
            m.value = BigInt(m.value);
    }
    return packet;
}

/**
 * Convert a string to a safe Sparkplug name. Removes all
 * non-alphanumeric characters except spaces and underscores, converts
 * to Title Case, replaces spaces with underscores, and ensures proper
 * separation in camelCase.
 *
 * @param {string} e - The string to convert
 * @returns {string} - The converted string
 */
export function sparkplug_safe (e) {
  return e?.replace(/[^A-Za-z0-9_ ]/g, '') // Remove non-alphanumeric characters except spaces and underscores
    .replace(/\b\w/g, (char) => char.toUpperCase()) // Convert to Title Case
    .replace(/ /g, '_') // Replace spaces with underscores
    .replace(/([a-z])([A-Z])/g, '$1_$2') // Ensure proper separation in camelCase
}

export class Address {
    constructor (group, node, device) {
        this.group = group;
        this.node = node;

        if (device == null || device == "")
            device = undefined;
        this.device = device;
    }

    static from (any) {
        if (any instanceof Address) return any;
        if (typeof any == "string") return Address.parse(any);
        throw new Error("Can't interpret ${any} as an Address");
    }

    static parse (addr) {
        return new Address(...addr.split("/"));
    }

    equals (other) {
        return this.group === other.group && 
            this.node === other.node &&
            this.device === other.device;
    }

    /* Checks for a match, allowing this address to be a wildcard. The
     * other address must be literal. The only wildcard is '+', which
     * allows any string (but not no string at all). */
    matches (other) {
        const wild = (p, a) => 
            p === a || 
            (p == "+" && a != undefined);

        return wild(this.group, other.group) &&
            wild(this.node, other.node) &&
            wild(this.device, other.device);
    }

    toString () {
        let node = `${this.group}/${this.node}`; 
        return this.isDevice() ? `${node}/${this.device}` : node;
    }

    isDevice () { return this.device != undefined; }
    topicKind () { return this.isDevice() ? "D" : "N" }

    topic (type) {
        return new Topic(this, type).toString();
    }

    parent_node () {
        return new Address(this.group, this.node);
    }

    child_device (device) {
        return new Address(this.group, this.node, device);
    }

    is_child_of (node) {
        return this.parent_node().equals(node);
    }
}

export class Topic {
    static prefix = "spBv1.0";

    constructor (address, type) {
        this.address = address;
        this.type = type;
    }

    static parse (topic) {
        const parts = topic.split("/");

        if (parts.length != 4 && parts.length != 5)
            return null;
        if (parts[0] != Topic.prefix)
            return null;

        const addr = new Address(parts[1], parts[3], parts[4]);
        const [, kind, type] = parts[2].match(/(.)(.*)/);

        if (kind != addr.topicKind())
            return null;

        return new Topic(addr, type);
    }

    toString () {
        const a = this.address;
        const t = this.type;
        const typ = 
            t == "+" ? t : a.topicKind() + t;

        const node = `${Topic.prefix}/${a.group}/${typ}/${a.node}`;
        return a.isDevice() ? `${node}/${a.device}` : node;
    }
}

