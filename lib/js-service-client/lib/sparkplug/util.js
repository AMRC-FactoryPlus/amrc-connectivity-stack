/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import Long from 'long'

/* Timestamps below this value are treated as milliseconds and converted
 * to nanoseconds. This threshold is 10^15, which as milliseconds is the
 * year ~33700 CE — safely beyond any real date we would encounter. As
 * nanoseconds it is about 11.5 days after the Unix epoch, also safely
 * in the past. */
const NS_THRESHOLD = 1_000_000_000_000_000n;
const MS_TO_NS     = 1_000_000n;

/* Convert a Long or number/bigint timestamp to a BigInt in nanoseconds.
 * Uses Long.toString() rather than toNumber() to avoid precision loss
 * for large nanosecond values (which exceed Number.MAX_SAFE_INTEGER). */
export function long_to_ns (ts) {
    const val = Long.isLong(ts) ? BigInt(ts.toString()) : BigInt(ts);
    return val < NS_THRESHOLD ? val * MS_TO_NS : val;
}

/* Convert a Long or number/bigint timestamp to a Date.
 * The Date is always millisecond-precision; use long_to_ns if you need
 * the full nanosecond value. */
export function long_to_date (ts) {
    const ns = long_to_ns(ts);
    return new Date(Number(ns / MS_TO_NS));
}

/** Remove Longs from a decoded Sparkplug packet.
 * This translates timestamps to Dates and aliases to BigInts. Values
 * which have decoded as Longs will also be converted to BigInts. This
 * does not attempt to handle templates or properties as we don't
 * currently use these.
 *
 * Each timestamp is decoded into two fields:
 *   - `timestamp`   Date (millisecond precision, for backward compat)
 *   - `timestampNs` BigInt nanoseconds since epoch (full precision)
 *
 * Edits `packet` in place and returns the result.
 */
export function sp_remove_longs (packet) {
    if ("timestamp" in packet) {
        const ns = long_to_ns(packet.timestamp);
        packet.timestampNs = ns;
        packet.timestamp   = new Date(Number(ns / MS_TO_NS));
    }
    for (const m of packet.metrics ?? []) {
        if ("alias" in m)
            m.alias = BigInt(m.alias);
        if ("timestamp" in m) {
            const ns = long_to_ns(m.timestamp);
            m.timestampNs = ns;
            m.timestamp   = new Date(Number(ns / MS_TO_NS));
        }
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
export function sparkplug_safe_string (e) {
    return e
      // Remove non-alphanumeric characters except spaces and underscores
      ?.replace(/[^A-Za-z0-9_ ]/g, '')

      // Convert to Title Case
      .replace(/\b\w/g, (char) => char.toUpperCase())

      // Replace spaces with underscores
      .replace(/ /g, '_')

      // Ensure proper separation in camelCase
      .replace(/([a-z])([A-Z])/g, '$1_$2')
}

/** Class representing a Sparkplug address. */
export class Address {
    /** Construct an address.
     * Omitting the `device` or passing the empty string will create a
     * Node address.
     * @arg group Group ID
     * @arg node Node ID
     * @arg device Device ID
     */
    constructor (group, node, device) {
        this.group = group;
        this.node = node;

        if (device == null || device == "")
            device = undefined;
        this.device = device;
    }

    /** Convert to Address.
     * Converts from Address or string. Otherwise throws.
     */
    static from (any) {
        if (any instanceof Address) return any;
        if (typeof any == "string") return Address.parse(any);
        throw new Error("Can't interpret ${any} as an Address");
    }

    /** Parse a string to an Address
     * Expects the format `Group/Node` or `Group/Node/Device`.
     */
    static parse (addr) {
        return new Address(...addr.split("/"));
    }

    /** Compare Addresses for equality. */
    equals (other) {
        return this.group === other.group &&
            this.node === other.node &&
            this.device === other.device;
    }

    /** Wildcard match.
     * Checks for a match, allowing this address to be a wildcard. The
     * other address must be literal. The only wildcard is '+', which
     * allows any string (but not no string at all).
     */
    matches (other) {
        const wild = (p, a) =>
            p === a ||
            (p == "+" && a != undefined);

        return wild(this.group, other.group) &&
            wild(this.node, other.node) &&
            wild(this.device, other.device);
    }

    /** Formats as `Group/Node` or `Group/Node/Device`. */
    toString () {
        let node = `${this.group}/${this.node}`;
        return this.isDevice() ? `${node}/${this.device}` : node;
    }

    /** Is this a Device address? */
    isDevice () { return this.device != undefined; }

    /** Get Sparkplug topic prefix.
     * @returns `D` or `N`.
     */
    topicKind () { return this.isDevice() ? "D" : "N" }

    /** Generate Sparkplug topic.
     * @arg type A topic type, `BIRTH`, `DATA`, `DEATH`, `CMD`.
     * @returns A Sparkplug topic name.
     */
    topic (type) {
        return new Topic(this, type).toString();
    }

    /** Find parent Node.
     * If this is a Node address, return the same address.
     * If this ia a Device address, return the parent Node address.
     */
    parent_node () {
        return new Address(this.group, this.node);
    }

    /** Make child Device address.
     * Return an Address with the same Group and Node but a new Device.
     */
    child_device (device) {
        return new Address(this.group, this.node, device);
    }

    /** Is this Address a child of the other?
     * Checks if this is a Device address underneath the given Node.
     */
    is_child_of (node) {
        return this.parent_node().equals(node);
    }
}

/** Class representing a Sparkplug topic. */
export class Topic {
    static prefix = "spBv1.0";

    /** Construct a Topic.
     * Topic types are `BIRTH`, `DATA`, `DEATH`, `CMD`.
     * @arg address An Address object.
     * @arg type The topic type.
     */
    constructor (address, type) {
        this.address = address;
        this.type = type;
    }

    /** Parse a topic name to a Topic.
     * @arg topic An MQTT topic string.
     * @returns A Topic, or null.
     */
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

    /** Format as an MQTT topic string. */
    toString () {
        const a = this.address;
        const t = this.type;
        const typ =
            t == "+" ? t : a.topicKind() + t;

        const node = `${Topic.prefix}/${a.group}/${typ}/${a.node}`;
        return a.isDevice() ? `${node}/${a.device}` : node;
    }
}

