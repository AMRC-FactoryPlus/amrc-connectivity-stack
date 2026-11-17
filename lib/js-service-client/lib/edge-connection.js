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

/** The `values.drivers` entry of an Edge Agent Deployment for a
 * connection. Undefined for a built-in driver, which has no sidecar.
 * @arg cconf The ConnectionConfiguration config.
 * @arg driverdef The DriverDefinition config of the connection.
 */
export function driver_values (cconf, driverdef) {
    const image = driverdef?.image;
    if (!image) return;
    return { ...(cconf?.deployment ?? {}), image };
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

    if (next.payloadFormat !== undefined)
        next.payloadFormat = format(next.payloadFormat);
    for (const device of next.devices ?? [])
        if (device.payloadFormat !== undefined)
            device.payloadFormat = format(device.payloadFormat);

    return next;
}
