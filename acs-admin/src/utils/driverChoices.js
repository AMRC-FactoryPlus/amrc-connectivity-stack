/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * The drivers the connection dialog offers, and how it finds the one
 * chosen.
 *
 * Since ACS 7 the built-in REST, MQTT, OPC UA and UDP DriverDefs are
 * kept, marked `hidden`, for connections on Edge Agents that still run
 * version 6 (acs-service-setup/lib/retired-drivers.js), and the split
 * DriverDefs that replace them have the same names. So a driver is
 * always chosen and found by its UUID, never by its name: by name, a
 * new connection could be saved on the hidden built-in driver, which a
 * version 7 Edge Agent can't run, and editing a connection could
 * quietly move it to the other driver of the same name.
 */

/**
 * The drivers to offer for a connection, sorted by name. A hidden
 * driver is offered only to a connection that already uses it, so it
 * still shows as that connection's driver.
 *
 * @param {Array} drivers - The driver store entries
 * @param {string} [current] - The UUID of the driver the connection uses, if it exists already
 * @returns {Array} - The driver store entries to offer
 */
export function driverChoices (drivers, current) {
  return (drivers ?? [])
    .filter(d => !d.definition?.hidden || d.uuid === current)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/**
 * The driver store entry with a UUID, or undefined.
 *
 * @param {Array} drivers - The driver store entries
 * @param {string} [uuid] - A DriverDef UUID
 * @returns {Object|undefined}
 */
export function driverByUuid (drivers, uuid) {
  if (!uuid) return
  return (drivers ?? []).find(d => d.uuid === uuid)
}
