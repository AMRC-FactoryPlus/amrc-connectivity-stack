# TP-Link driver

This is a driver for TP link smartplugs using the tplink-smarthome-api package.

## Configuration

The configuration has two components.

Property | Meaning
---|---
`host` | The device to connect to
`timeout` | Timeout in milliseconds (ms) for communication with the plug

## Addresses

All addresses return JSON.

### `SysInfo`

This returns general information about the plug, including:

Name | Type | Description
---|---|---
`mac` | string | The MAC address of the plug
`model` | string | The model number of the plug
`relay_state` | 0/1 | State of the remote control relay

There is additional information included which is not documented here.

### `PowerState`

This returns a Boolean representing whether the Plug relay is on (`true`) or off (`false`).

### `InUse`

This returns a Boolean representing whether the device is in use or not.

### `Meter`

This returns current energy information about the plug, including its current, power and voltage.

Name | Type| Description
---|---|---
`current` | Float | The current through the plug in Amperes (A)
`current_ma` | Integer | The current through the plug in Milliamperes (mA)
`power` | Float | The current power usage of the plug in Watts (W)
`power_mw` | Integer | The current power usage of the plug in Milliwatts (mW)
`voltage` | Float | The voltage across the plug in Volts (V)
`voltage` | Integer | The voltage across the plug in Millivolts (mV)
`total_wh` | Integer | The total energy supplied to the plug in watt-hours (wh)


