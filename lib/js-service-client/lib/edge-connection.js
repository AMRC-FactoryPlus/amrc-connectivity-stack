/*
 * Factory+ NodeJS Utilities
 * Edge Agent connection entries: the driver-dependent parts
 * Copyright 2026 University of Sheffield AMRC
 *
 * A connection's Edge Agent config entry and its deployment values
 * both depend on its DriverDef. A DriverDef with `internal` is built
 * into the Edge Agent: the entry names its `connType` and keeps the
 * connection details under its own key (`OPCUAConnDetails` and so
 * on). Any other DriverDef runs as a split driver: the entry is of
 * type `Driver` with the details under `DriverDetails`, and the
 * deployment needs a `values.drivers.<name>` entry so the sidecar and
 * its password are rendered.
 *
 * The admin UI and service-setup both write these, so both use the
 * functions here and cannot disagree. Service-setup also moves
 * connections between an internal driver and the split driver that
 * replaces it (acs-service-setup/lib/split-drivers.js); the move
 * functions are here so the admin UI tests can check a later save
 * agrees with a move.
 *
 * Everything in this file is pure: no service calls, no I/O.
 */

/** The payload format the admin UI gives a device whose connection
 * names none. */
export const DEFAULT_PAYLOAD_FORMAT = "Defined by Protocol";

/* Every key an entry has held connection details under. */
const DETAILS_KEY = /(?:ConnDetails|^DriverDetails)$/;

/** The connection type and details key a DriverDef gives a
 * connection in the Edge Agent config.
 * @arg driverdef A DriverDefinition config.
 * @returns `{ connType, details }`.
 */
export function connection_type (driverdef) {
    const internal = driverdef?.internal;
    if (internal)
        return { connType: internal.connType, details: internal.details };
    return { connType: "Driver", details: "DriverDetails" };
}

/** Set the connection type and details of an Edge Agent config
 * connection entry, in place. Any details held under another key are
 * removed, so an entry never carries both a built-in and a driver
 * details key.
 * @arg entry An entry of `deviceConnections`.
 * @arg driverdef The DriverDefinition config of the connection.
 * @arg details The connection details. If undefined, the entry keeps
 * no details.
 * @returns The entry.
 */
export function set_connection_type (entry, driverdef, details) {
    const { connType, details: key } = connection_type(driverdef);

    entry.connType = connType;
    for (const k of Object.keys(entry))
        if (k != key && DETAILS_KEY.test(k))
            delete entry[k];
    if (details === undefined)
        delete entry[key];
    else
        entry[key] = details;

    return entry;
}

/** The connection details an Edge Agent config entry holds, whichever
 * key they are under. Undefined if it holds none.
 * @arg entry An entry of `deviceConnections`.
 */
export function connection_details (entry) {
    const key = Object.keys(entry ?? {}).find(k => DETAILS_KEY.test(k));
    return key ? entry[key] : undefined;
}

/* Host ports.
 *
 * A DriverDef can say its driver listens on ports taken from the
 * connection's config, for devices that send to the driver rather
 * than the driver reaching out to them:
 *
 *   hostPorts:
 *     - protocol: UDP
 *       field: port
 *
 * The chart opens each of these on the node the Edge Agent runs on
 * (a `hostPort` on the driver's container), so a device outside the
 * cluster can send to the node's address. The port follows the
 * connection's config, so changing it there moves the open port. */

const PROTOCOLS = ["UDP", "TCP"];

/* A port number from a config field: a whole number or a string of
 * digits, from 1 to 65535. */
function port_number (value) {
    const n = typeof value == "string" && /^\d+$/.test(value.trim())
        ? Number(value) : value;
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined;
}

/** The ports a connection's driver listens on, from its DriverDef's
 * `hostPorts` and the connection's config. A field with no valid port
 * opens nothing; the driver reports the bad config itself.
 * @arg cconf The ConnectionConfiguration config.
 * @arg driverdef The DriverDefinition config of the connection.
 * @returns A list of `{ protocol, port }`, maybe empty.
 */
export function driver_ports (cconf, driverdef) {
    const decl = driverdef?.hostPorts;
    if (!Array.isArray(decl) || !driverdef?.image) return [];

    const ports = [];
    for (const { protocol, field } of decl) {
        if (!PROTOCOLS.includes(protocol) || typeof field != "string")
            continue;
        const port = port_number(cconf?.config?.[field]);
        if (port !== undefined
            && !ports.some(p => p.protocol == protocol && p.port == port))
            ports.push({ protocol, port });
    }
    return ports;
}

/** Find connections that ask for the same host port where they could
 * land on the same node. Two connections can share a node if they are
 * in the same cluster and are pinned to the same host, or either is
 * not pinned to a host.
 * @arg conns A list of `{ name, cluster, hostname, ports }`, `ports`
 * as from `driver_ports`.
 * @returns A list of `{ protocol, port, names }`, one for each pair
 * that clashes, `names` the two connection names.
 */
export function port_clashes (conns) {
    const clashes = [];
    conns.forEach((a, i) => {
        for (const b of conns.slice(i + 1)) {
            if (a.cluster != b.cluster) continue;
            if (a.hostname && b.hostname && a.hostname != b.hostname)
                continue;
            for (const p of a.ports ?? [])
                if ((b.ports ?? []).some(q =>
                        q.protocol == p.protocol && q.port == p.port))
                    clashes.push({ ...p, names: [a.name, b.name] });
        }
    });
    return clashes;
}

/** The `values.drivers` entry of an Edge Agent Deployment for a
 * connection. Undefined for a built-in driver, which has no sidecar.
 * The entry has `hostPorts` only if the driver listens on any.
 * @arg cconf The ConnectionConfiguration config.
 * @arg driverdef The DriverDefinition config of the connection.
 */
export function driver_values (cconf, driverdef) {
    const image = driverdef?.image;
    if (!image) return;
    const values = { ...(cconf?.deployment ?? {}), image };
    delete values.hostPorts;
    const ports = driver_ports(cconf, driverdef);
    if (ports.length) values.hostPorts = ports;
    return values;
}

/** The payload format a connection or device has after a move.
 * @arg format The format before the move.
 * @arg map The protocol's `payloadFormat` map, internal to split.
 * @arg to_split True when moving to the split driver.
 * @arg original The format recorded when the connection was moved to
 * the split driver, if any.
 */
export function move_payload_format (format, map, to_split, original) {
    if (to_split)
        return map[format] ?? format;

    /* Moving back: undo the forward mapping, but only where the
     * format is still what the forward move gave it. */
    if (original !== undefined)
        return (map[original] ?? original) == format ? original : format;
    const back = Object.entries(map).find(([, v]) => v == format);
    return back ? back[0] : format;
}

/** The ConnectionConfiguration after a move.
 * @arg cconf The current config.
 * @arg proto `{ internal, split, payloadFormat }`: the two DriverDef
 * UUIDs and the payload format map, internal to split.
 * @arg to_split True when moving to the split driver.
 */
export function move_connection (cconf, proto, to_split) {
    const next = structuredClone(cconf);
    /* The admin UI gives devices the default when the connection names
     * no format, so map that, and write it out. */
    const format = cconf.source?.payloadFormat ?? DEFAULT_PAYLOAD_FORMAT;

    if (to_split) {
        next.driver = proto.split;
        /* Kept so that moving back restores the format exactly. */
        next.splitMigration = { from: proto.internal, payloadFormat: format };
    }
    else {
        next.driver = proto.internal;
        delete next.splitMigration;
    }

    next.source = {
        ...(cconf.source ?? {}),
        payloadFormat: move_payload_format(format, proto.payloadFormat,
            to_split, cconf.splitMigration?.payloadFormat),
    };

    return next;
}

/** An Edge Agent config connection entry after a move.
 * @arg entry The current entry.
 * @arg driverdef The DriverDef moved to.
 * @arg format A function mapping a payload format to its new value.
 * @arg fallback Connection details to use if the entry has none.
 */
export function move_entry (entry, driverdef, format, fallback) {
    const next = structuredClone(entry);

    set_connection_type(next, driverdef, connection_details(entry) ?? fallback);

    /* The Edge Agent gives every device its connection's payload
     * format (acs-edge/utils/FormatConfig.ts), so an entry without one
     * leaves every device with none. A built-in connection that decodes
     * its own values doesn't mind, but a split driver's devices would
     * get no data. Such an entry has the admin UI's default. */
    next.payloadFormat = format(next.payloadFormat ?? DEFAULT_PAYLOAD_FORMAT);
    for (const device of next.devices ?? [])
        if (device.payloadFormat !== undefined)
            device.payloadFormat = format(device.payloadFormat);

    return next;
}

/* Driver ids.
 *
 * A split driver's id is its MQTT username and client id on the Edge
 * Agent's driver broker, its key in the driver passwords secret and,
 * prefixed with `driver-` and lowercased, its container name. The
 * broker routes only `[\w-]+` and a container name is at most 63
 * lowercase letters, digits and hyphens, so not every connection name
 * can be an id.
 *
 * A name that already works as all of these is its own id, so drivers
 * running today keep their names. Any other connection gets a
 * lowercase form of its name with part of its UUID on the end,
 * written to its config entry as `driverId`, so the id never changes
 * once it is given. */

/* The container name is `driver-<id>`, at most 63 characters. */
const MAX_ID = 63 - "driver-".length;

/* A name that works as an id today. The chart lowercases the
 * container name, so capitals work. */
const NAME_ID = /^[A-Za-z0-9-]*[A-Za-z0-9]$/;
/* An id this code gives. */
const GIVEN_ID = /^[a-z0-9-]*[a-z0-9]$/;

/* How many hex digits of the UUID tag an id, before and after a
 * clash. 32 is the whole UUID. */
const TAG_SHORT = 8;
const TAG_LONG = 32;

/* 32-bit FNV-1a, for an entry with no UUID. */
function fnv1a (str) {
    let h = 0x811c9dc5;
    for (const c of new TextEncoder().encode(str))
        h = Math.imul(h ^ c, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
}

/* An id from a connection name and part of its UUID. */
function tagged_id (entry, digits) {
    const hex = entry.uuid
        ? entry.uuid.toLowerCase().replace(/[^0-9a-f]/g, "")
        : fnv1a(entry.name ?? "");
    const tag = hex.slice(0, digits);
    const base = (entry.name ?? "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, MAX_ID - tag.length - 1)
        .replace(/^-+|-+$/g, "");
    return base ? `${base}-${tag}` : tag;
}

/** Whether a connection name works as a driver id as it is.
 * @arg name A connection name.
 */
export function is_driver_id (name) {
    return typeof name == "string" && name.length <= MAX_ID
        && NAME_ID.test(name);
}

/** The driver id of an Edge Agent config connection entry: its
 * `driverId` if it has one, or else its name. This is what the Edge
 * Agent uses, and what keys the entry's `values.drivers` entry in the
 * Edge Agent Deployment.
 * @arg entry An entry of `deviceConnections`.
 */
export function driver_id (entry) {
    return entry?.driverId ?? entry?.name;
}

/** Work out the driver ids of the connections of one Edge Agent.
 * Every id is unique within the list, ignoring case, and works as an
 * MQTT username, a secret key and, after `driver-`, a container name.
 *
 * An entry keeps a `driverId` it already has, or else its name if
 * that works as an id, and otherwise gets its name in lowercase with
 * hyphens and the first 8 hex digits of its UUID on the end. Where two
 * ids are the same, an id that is all lowercase and was kept is left
 * alone if it is the only one, and the others move on: a kept id to
 * the 8 digit form, and that to the whole UUID.
 *
 * @arg entries Entries of `deviceConnections`, with `name` and `uuid`.
 * @returns The ids, in the same order.
 */
export function driver_ids (entries) {
    const kept = e =>
        typeof e.driverId == "string" && e.driverId.length <= MAX_ID
            && GIVEN_ID.test(e.driverId) ? e.driverId
        : is_driver_id(e.name) ? e.name
        : undefined;

    /* tier 0 is a kept id, 1 and 2 the short and long tagged ids. */
    const tier = entries.map(e => kept(e) === undefined ? 1 : 0);
    const ids = entries.map((e, i) => tier[i] ? tagged_id(e, TAG_SHORT) : kept(e));

    for (let round = 0; round < 3; round++) {
        const groups = new Map();
        ids.forEach((id, i) => {
            const k = id.toLowerCase();
            groups.set(k, [...(groups.get(k) ?? []), i]);
        });

        let clash = false;
        for (const group of groups.values()) {
            if (group.length < 2) continue;
            clash = true;
            const stay = group.filter(i => tier[i] == 0 && ids[i] == ids[i].toLowerCase());
            for (const i of group) {
                if (stay.length == 1 && i == stay[0]) continue;
                if (tier[i] >= 2) continue;
                tier[i]++;
                ids[i] = tagged_id(entries[i], tier[i] == 1 ? TAG_SHORT : TAG_LONG);
            }
        }
        if (!clash) break;
    }

    return ids;
}

/** Give each split driver connection of an Edge Agent config its
 * driver id, in place. A connection whose id is its name has no
 * `driverId`, so a config whose names all work as ids is unchanged.
 * Built-in connections have no sidecar and no `driverId`, so a
 * connection moved to a split driver and back is as it was.
 * @arg entries The `deviceConnections` of an Edge Agent config.
 * @returns The entries.
 */
export function set_driver_ids (entries) {
    const drivers = [];
    for (const entry of entries ?? []) {
        if (entry.connType == "Driver") drivers.push(entry);
        else delete entry.driverId;
    }
    driver_ids(drivers).forEach((id, i) => {
        const entry = drivers[i];
        if (id == entry.name) delete entry.driverId;
        else entry.driverId = id;
    });
    return entries;
}
