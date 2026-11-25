/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The names a person gives connections and devices on the Edge
 * Manager, and what each one becomes downstream.
 *
 * A device's name is its Sparkplug device ID: the Edge Agent config
 * takes `deviceId` from it unchanged, and the Edge Agent publishes the
 * device's births and data under that ID. Sparkplug only forbids "+",
 * "/" and "#" there, but other Sparkplug consumers store and query the
 * ID, so names keep to a plain set of characters.
 *
 * A connection's name needs no rule for most drivers. A split driver
 * runs in a container whose id (`driver_id` in the service client) is
 * made from the name, cleaned up, so any name works. Connections use
 * the same rule as devices so the two dialogs agree.
 *
 * An external driver (a DriverDef with `external: true` and no image)
 * is the exception. It runs outside the Edge Agent's pod and logs in to
 * the Edge Agent's driver broker with the connection name as its MQTT
 * username and client id. The broker only routes `fpEdge1/<id>/...`
 * topics whose id is letters, numbers, "_" and "-", and the name is
 * also the key of the driver's password in a Kubernetes secret, so for
 * those the name must be exactly that. */

const NAME_CHARS = /^[A-Za-z0-9 _.-]*$/;
const HAS_ALNUM = /[A-Za-z0-9]/;
const EXTERNAL_ID = /^[A-Za-z0-9_-]+$/;

export const DEVICE_NAME_HINT =
  'Use letters, numbers, spaces, hyphens, underscores and dots. ' +
  'The name is also the device\'s Sparkplug ID, so other symbols are not allowed.';

export const CONNECTION_NAME_HINT =
  'Use letters, numbers, spaces, hyphens, underscores and dots.';

export const EXTERNAL_NAME_HINT =
  'Use letters, numbers, hyphens and underscores, with no spaces or dots. ' +
  'An external driver logs in to the Edge Agent with this name.';

/** Whether a DriverDef is for an external driver, which logs in to the
 * Edge Agent under its connection's name. */
export function is_external_driver (driverdef) {
  return driverdef?.external === true && !driverdef?.image;
}

/** Why a device or connection name is not allowed, or null. An empty
 * name is left to the required check. */
export function name_problem (name) {
  if (name == null || name === '') return null;
  if (!NAME_CHARS.test(name))
    return 'Only letters, numbers, spaces, hyphens, underscores and dots are allowed';
  if (!HAS_ALNUM.test(name))
    return 'The name needs at least one letter or number';
  return null;
}

/** Why a connection name is not allowed for an external driver, or
 * null. */
export function external_name_problem (name) {
  if (name == null || name === '') return null;
  if (!EXTERNAL_ID.test(name))
    return 'An external driver\'s connection name can only have letters, numbers, hyphens and underscores';
  return null;
}

/** The hint shown under a connection's name field, for its driver. */
export function connection_name_hint (driverdef) {
  return is_external_driver(driverdef) ? EXTERNAL_NAME_HINT : CONNECTION_NAME_HINT;
}

/** Why a connection name is not allowed with this driver, or null. */
export function connection_name_problem (name, driverdef) {
  return name_problem(name)
    ?? (is_external_driver(driverdef) ? external_name_problem(name) : null);
}
