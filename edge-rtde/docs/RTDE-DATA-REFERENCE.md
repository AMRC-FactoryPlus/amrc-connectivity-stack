# Universal Robots RTDE Data Reference

This document lists all data available from the RTDE driver and how to access it using JSONPath expressions in the Edge Agent ConfigDB.

## Driver Addresses

The driver publishes data to the following addresses:

| Address | Description |
|---------|-------------|
| `json/state` | Complete robot state (all sections combined) |
| `json/jointData` | Joint-specific data for all 6 joints |
| `json/cartesianInfo` | Tool Center Point (TCP) position and orientation |
| `json/robotModeData` | Robot operational mode and status |
| `json/toolData` | Tool flange I/O and power data |
| `json/masterboardData` | Master board I/O and safety information |
| `json/forceModeFrame` | Force mode configuration |
| `json/additionalInfo` | Additional robot information |
| `json/toolCommunicationInfo` | Tool communication settings |

---

## Joint Data (`json/jointData`)

Array of 6 objects (one per joint: Base, Shoulder, Elbow, Wrist1, Wrist2, Wrist3)

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$[0].positionActual` | Float | radians | Base joint actual position |
| `$[0].positionTarget` | Float | radians | Base joint target position |
| `$[0].velocityActual` | Float | rad/s | Base joint actual velocity |
| `$[0].currentActual` | Float | A | Base joint actual current |
| `$[0].voltageActual` | Float | V | Base joint actual voltage |
| `$[0].motorTemperature` | Float | °C | Base joint motor temperature |
| `$[0].controlCurrent` | Float | A | Base joint control current |
| `$[0].mode` | Integer | - | Base joint control mode (see modes below) |

**Note:** Replace `[0]` with `[1]` through `[5]` for Shoulder, Elbow, Wrist1, Wrist2, and Wrist3 joints respectively.

### Joint Control Modes
- `236`: Position control
- `237`: Velocity control  
- `238`: Force control
- `239`: Torque control

---

## Cartesian Information (`json/cartesianInfo`)

Tool Center Point (TCP) position and orientation

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.toolVectorX` | Float | m | TCP X position in base coordinate system |
| `$.toolVectorY` | Float | m | TCP Y position in base coordinate system |
| `$.toolVectorZ` | Float | m | TCP Z position in base coordinate system |
| `$.toolVectorRX` | Float | radians | TCP rotation around X axis |
| `$.toolVectorRY` | Float | radians | TCP rotation around Y axis |
| `$.toolVectorRZ` | Float | radians | TCP rotation around Z axis |
| `$.tcpSpeedActual` | Float | m/s | Actual TCP speed |
| `$.tcpForce` | Float | N | TCP force magnitude |

---

## Robot Mode Data (`json/robotModeData`)

Robot operational state and status flags

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.timestamp` | Integer | µs | Robot timestamp (microseconds) - **DO NOT USE** |
| `$.isRobotConnected` | Boolean | - | Robot connected to controller |
| `$.isRealRobotEnabled` | Boolean | - | Real robot mode enabled (not simulation) |
| `$.isPowerOnRobot` | Boolean | - | Power supply to robot is on |
| `$.isEmergencyStopPressed` | Boolean | - | Emergency stop button pressed |
| `$.isProtectiveStopActive` | Boolean | - | Protective stop active |
| `$.isProgramRunning` | Boolean | - | UR program currently running |
| `$.isProgramPaused` | Boolean | - | UR program paused |
| `$.robotMode` | Integer  | - | Robot operational mode (see modes below) |
| `$.controlMode` | Integer | - | Control interface in use (see control modes below) |
| `$.targetSpeedFraction` | Float | 0-1 | Target speed as fraction of maximum |
| `$.speedScaling` | Float | 0-1 | Current speed scaling factor |
| `$.targetSpeedFractionLimit` | Float | 0-1 | Maximum allowed target speed fraction |

### Robot Modes
- `-1`: ROBOT_MODE_DISCONNECTED
- `0`: ROBOT_MODE_CONFIRM_SAFETY
- `1`: ROBOT_MODE_BOOTING
- `2`: ROBOT_MODE_POWER_OFF
- `3`: ROBOT_MODE_POWER_ON
- `4`: ROBOT_MODE_IDLE
- `5`: ROBOT_MODE_BACKDRIVE
- `6`: ROBOT_MODE_RUNNING
- `7`: ROBOT_MODE_UPDATING_FIRMWARE

### Control Modes
- `0`: CONTROL_MODE_TEACH
- `1`: CONTROL_MODE_FREEDRIVE  
- `2`: CONTROL_MODE_REMOTE (RTDE/URScript control)

---

## Tool Data (`json/toolData`)

Tool flange digital I/O and power supply

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.analogInputRange0` | Integer | - | Analog input 0 range setting |
| `$.analogInputRange1` | Integer | - | Analog input 1 range setting |
| `$.analogInput0` | Float | V or A | Analog input 0 value |
| `$.analogInput1` | Float | V or A | Analog input 1 value |
| `$.toolVoltage48V` | Float | V | 48V tool supply voltage |
| `$.toolOutputVoltage` | Integer | V | Tool output voltage setting |
| `$.toolCurrent` | Float | A | Tool current consumption |
| `$.toolTemperature` | Float | °C | Tool temperature |
| `$.toolOutputCurrent` | Float | A | Tool output current |

---

## Master Board Data (`json/masterboardData`)

Controller board I/O and safety information

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.digitalInputBits` | Integer | bitmask | Digital inputs state (bits 0-17) |
| `$.digitalOutputBits` | Integer | bitmask | Digital outputs state (bits 0-17) |
| `$.analogInputRange0` | Integer | - | Analog input 0 range |
| `$.analogInputRange1` | Integer | - | Analog input 1 range |
| `$.analogInput0` | Float | V or A | Analog input 0 value |
| `$.analogInput1` | Float | V or A | Analog input 1 value |
| `$.analogOutputDomain0` | Integer | - | Analog output 0 domain |
| `$.analogOutputDomain1` | Integer | - | Analog output 1 domain |
| `$.analogOutput0` | Float | V or A | Analog output 0 value |
| `$.analogOutput1` | Float | V or A | Analog output 1 value |
| `$.masterBoardTemperature` | Float | °C | Controller board temperature |
| `$.robotVoltage48V` | Float | V | 48V robot supply voltage |
| `$.robotCurrent` | Float | A | Total robot current consumption |
| `$.masterIOCurrent` | Float | A | Master board I/O current |
| `$.safetyMode` | Integer | - | Safety system mode (see safety modes below) |
| `$.inReducedMode` | Integer | - | Robot in reduced mode (0=normal, 1=reduced) |

### Safety Modes
- `1`: NORMAL
- `2`: REDUCED
- `3`: PROTECTIVE_STOP
- `4`: RECOVERY
- `5`: SAFEGUARD_STOP
- `6`: SYSTEM_EMERGENCY_STOP
- `7`: ROBOT_EMERGENCY_STOP
- `8`: VIOLATION
- `9`: FAULT

### Digital I/O Bit Positions
- Bits 0-7: Configurable digital inputs
- Bits 8-9: Tool digital inputs
- Bits 10-17: Configurable digital outputs

---

## Force Mode Frame (`json/forceModeFrame`)

Active force mode configuration

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.x` | Float | m | Force frame X position |
| `$.y` | Float | m | Force frame Y position |
| `$.z` | Float | m | Force frame Z position |
| `$.rx` | Float | radians | Force frame rotation X |
| `$.ry` | Float | radians | Force frame rotation Y |
| `$.rz` | Float | radians | Force frame rotation Z |

---

## Additional Info (`json/additionalInfo`)

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.freedriveButtonPressed` | Boolean | - | Freedrive button currently pressed |
| `$.freedriveButtonEnabled` | Boolean | - | Freedrive button enabled in safety config |

---

## Tool Communication Info (`json/toolCommunicationInfo`)

| JSONPath | Data Type | Unit | Description |
|----------|-----------|------|-------------|
| `$.toolCommunicationIsEnabled` | Boolean | - | Tool communication enabled |
| `$.baudRate` | Integer | baud | Tool communication baud rate |
| `$.parity` | Integer | - | Parity setting (0=none, 1=odd, 2=even) |
| `$.stopBits` | Integer | - | Stop bits (1 or 2) |
| `$.rxIdleChars` | Float | - | RX idle characters |
| `$.txIdleChars` | Float | - | TX idle characters |

---

## Complete State (`json/state`)

All the above data combined in a single object. Use the same JSONPaths but without the address prefix.

Example: To get base joint position from complete state:
- Address: `json/state`
- Path: `$.jointData[0].positionActual`

---

## Usage Examples

### Example 1: Base Joint Position
```json
{
  "Address": "json/jointData",
  "Path": "$[0].positionActual",
  "Sparkplug_Type": "Float",
  "Eng_Unit": "rad",
  "Eng_Low": -6.2832,
  "Eng_High": 6.2832
}
```

### Example 2: TCP X Position
```json
{
  "Address": "json/cartesianInfo",
  "Path": "$.toolVectorX",
  "Sparkplug_Type": "Float",
  "Eng_Unit": "m"
}
```

### Example 3: Emergency Stop Status
```json
{
  "Address": "json/robotModeData",
  "Path": "$.isEmergencyStopPressed",
  "Sparkplug_Type": "Boolean"
}
```

### Example 4: Robot Mode
```json
{
  "Address": "json/robotModeData",
  "Path": "$.robotMode",
  "Sparkplug_Type": "Int32"
}
```

### Example 5: Tool Temperature
```json
{
  "Address": "json/toolData",
  "Path": "$.toolTemperature",
  "Sparkplug_Type": "Float",
  "Eng_Unit": "°C"
}
```

---

## Important Notes

### ⚠️ DO NOT Use Timestamps
The `$.timestamp` field in `robotModeData` is in **microseconds** (16 digits) which causes overflow errors in InfluxDB. The Edge Agent automatically adds timestamps using the current system time. **Never extract timestamp fields from RTDE data.**

### 📊 Recommended Data Types
- **Positions/Distances**: Float (radians or meters)
- **Velocities**: Float (rad/s or m/s)
- **Currents**: Float (A)
- **Voltages**: Float (V)
- **Temperatures**: Float (°C)
- **Booleans**: Boolean
- **Modes/Enums**: Int32 or UInt32
- **Bitmasks**: UInt32

### 🔢 Unit Conversions
If you need degrees instead of radians, use a conversion factor in your visualization:
- **Radians to Degrees**: multiply by `57.2958` (180/π)
- **Meters to Millimeters**: multiply by `1000`

### 🎯 Throttling Configuration
The driver supports throttling to prevent overwhelming the historian:

```json
{
  "DriverDetails": {
    "host": "192.168.1.103",
    "port": 30001,
    "throttle": true,
    "pollInt": 500
  }
}
```

- `throttle`: `true` to enable throttling, `false` for full rate (~125Hz)
- `pollInt`: Publish interval in milliseconds (default 500ms = 2Hz)

---

## Reference Links

- [Universal Robots RTDE Guide](https://www.universal-robots.com/articles/ur/interface-communication/real-time-data-exchange-rtde-guide/)
- [ur-rtde Library](https://gitlab.com/sdurobotics/ur_rtde)
