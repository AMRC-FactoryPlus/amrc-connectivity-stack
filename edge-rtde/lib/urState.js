class urState {
  initRobotStatePacket(type) {
    switch (type) {
      case 0:
        this.robotModeData = {
          timestamp: null,
          physicalRobotConnected: null,
          realRobotEnabled: null,
          robotPowerOn: null,
          emergencyStopped: null,
          protectiveStopped: null,
          programPaused: null,
          programRunning: null,
          robotMode: null,
          robotModeDescription: null,
          controlMode: null,
          controlModeDescription: null,
          targetSpeedFraction: null,
          speedScaling: null,
          targetSpeedFractionLimit: null,
        };
        break;
      case 1:
        this.jointData = [];
        for (let i = 0; i != 6; i++) {
          this.jointData.push(new urJoint(i));
        }
        break;
      case 2:
        this.toolData = {
          analogInputRange0: null,
          analogInputRange1: null,
          analogIn0: null,
          analogIn1: null,
          toolVoltage48V: null,
          toolOutputVoltage: null,
          toolCurrent: null,
          toolTemperature: null,
          mode: null,
          modeDescription: null,
        };
        break;
      case 3:
        this.masterboardData = {
          digitalInputBits: null,
          digitalOutputBits: null,
          analogInputRange0: null,
          analogInputRange1: null,
          analogIn0: null,
          analogIn1: null,
          analogOutputDomain0: null,
          analogOutputDomain1: null,
          analogOut0: null,
          analogOut1: null,
          temperature: null,
          robotVoltage48V: null,
          robotCurrent: null,
          masterIOCurrent: null,
          safetymode: null,
          safetymodeDescription: null,
          inReduceMode: null,
          euromap67installed: null,
          euromapInputBits: null,
          euromapOutputBits: null,
          euromapVoltage: null,
          euromapCurrent: null,
          operationalModeSelectorInput: null,
          threePositionEnablingDeviceInput: null,
        };
        break;
      case 4:
        this.cartesianInfo = {
          toolVectorX: null,
          toolVectorY: null,
          toolVectorZ: null,
          toolRx: null,
          toolRy: null,
          toolRz: null,
          tcpOffsetX: null,
          tcpOffsetY: null,
          tcpOffsetZ: null,
          tcpOffsetRx: null,
          tcpOffsetRy: null,
          tcpOffsetRz: null,
        };
        break;
      case 6:
        this.configData = {
          jointLimits: [],
          jointMaxValues: [],
          defaultSpeedLimit: null,
          defaultAccelerationLimit: null,
          defaultToolSpeedLimit: null,
          defaultToolAccelerationLimit: null,
          characteristicSizeTool: null,
          jointDHa: [],
          jointDHd: [],
          jointDHalpha: [],
          jointDHthetha: [],
          masterboardVersion: null,
          controllerBoxType: null,
          robotType: null,
          robotSubType: null,
        };
        for (let i = 0; i < 6; i++) {
          var json = {
            jointMinLimit: null,
            jointMaxLimit: null,
          };
          this.configData.jointLimits.push(json);
        }
        for (let i = 0; i < 6; i++) {
          var json = {
            jointMaxSpeed: null,
            jointMaxAcceleration: null,
          };
          this.configData.jointMaxValues.push(json);
        }
        break;
      case 7:
        this.forceModeFrame = {
          xValue: null,
          yValue: null,
          zValue: null,
          rxValue: null,
          ryValue: null,
          rzValue: null,
          robotDexterity: null,
        };
        break;
      case 8:
        this.additionalInfo = {
          freedriveButtonPressed: null,
          freedriveButtonEnabled: null,
          ioEnabledFreedrive: null,
        };
        break;
      case 11:
        this.toolCommunicationInfo = {
          enabled: null,
          baudrate: null,
          parity: null,
          rxIdleChars: null,
          txIdleChars: null,
        };
        break;
      default:
        break;
    }
  }
  constructor() {}
  getState() {
    return this;
  }
}

exports.urState = urState;

class urJoint {
  constructor() {
    this.codeId = null;
    this.positionActual = null;
    this.positionTarget = null;
    this.positionActualDegree = null;
    this.positionTargetDegree = null;
    this.speedActual = null;
    this.currentActual = null;
    this.voltageActual = null;
    this.motorTemperature = null;
    this.mode = null;
    this.modeDescription = null;
  }
  setJointPosition(value) {
    this.jointPosition = value;
    this.jointDegree = (this.jointPosition * 180) / Math.PI;
  }
}

exports.urJoint = urJoint;

class jointModes {
  constructor() {
    this.jointModes = [
      { number: 235, description: "JOINT_MODE_RESET" },
      { number: 236, description: "JOINT_MODE_SHUTTING_DOWN" },
      { number: 237, description: "JOINT_PART_D_CALIBRATION_MODE" },
      { number: 238, description: "JOINT_MODE_BACKDRIVE" },
      { number: 239, description: "JOINT_MODE_POWER_OFF" },
      { number: 240, description: "JOINT_MODE_READY_FOR_POWER_OFF" },
      { number: 245, description: "JOINT_MODE_NOT_RESPONDING" },
      { number: 246, description: "JOINT_MODE_MOTOR_INITIALISATION" },
      { number: 247, description: "JOINT_MODE_BOOTING" },
      { number: 248, description: "JOINT_PART_D_CALIBRATION_ERROR_MODE" },
      { number: 249, description: "JOINT_MODE_BOOTLOADER" },
      { number: 250, description: "JOINT_CALIBRATION_MODE" },
      { number: 251, description: "JOINT_MODE_VIOLATION" },
      { number: 252, description: "JOINT_MODE_FAULT" },
      { number: 253, description: "JOINT_MODE_RUNNING" },
      { number: 255, description: "JOINT_MODE_IDLE" },
    ];
  }

  getText(num) {
    var res = this.jointModes.filter((mode) => mode.number === num);
    if (res.length > 0) {
      return res[0].description;
    }
    return undefined;
  }
}
exports.jointModes = jointModes;

class robotModes {
  constructor() {
    this.robotModes = [
      { number: -1, description: "ROBOT_MODE_NO_CONTROLLER" },
      { number: 0, description: "ROBOT_MODE_DISCONNECTED" },
      { number: 1, description: "ROBOT_MODE_CONFIRM_SAFETY" },
      { number: 2, description: "ROBOT_MODE_BOOTING" },
      { number: 3, description: "ROBOT_MODE_POWER_OFF" },
      { number: 4, description: "ROBOT_MODE_POWER_ON" },
      { number: 5, description: "ROBOT_MODE_IDLE" },
      { number: 6, description: "ROBOT_MODE_BACKDRIVE" },
      { number: 7, description: "ROBOT_MODE_RUNNING" },
      { number: 8, description: "ROBOT_MODE_UPDATING_FIRMWARE" },
    ];
  }

  getText(num) {
    var res = this.robotModes.filter((mode) => mode.number === num);
    if (res.length > 0) {
      return res[0].description;
    }
    return undefined;
  }
}
exports.robotModes = robotModes;

class controlModes {
  constructor() {
    this.controlModes = [
      { number: 0, description: "CONTROL_MODE_POSITION" },
      { number: 1, description: "CONTROL_MODE_TEACH" },
      { number: 2, description: "CONTROL_MODE_FORCE" },
      { number: 3, description: "CONTROL_MODE_TORQUE" },
    ];
  }

  getText(num) {
    var res = this.controlModes.filter((mode) => mode.number === num);
    if (res.length > 0) {
      return res[0].description;
    }
    return undefined;
  }
}
exports.controlModes = controlModes;

class toolModes {
  constructor() {
    this.toolModes = [
      { number: 235, description: "JOINT_MODE_RESET" },
      { number: 236, description: "JOINT_MODE_SHUTTING_DOWN" },
      { number: 239, description: "JOINT_MODE_POWER_OFF" },
      { number: 245, description: "JOINT_MODE_NOT_RESPONDING" },
      { number: 247, description: "JOINT_MODE_BOOTING" },
      { number: 249, description: "JOINT_MODE_BOOTLOADER" },
      { number: 252, description: "JOINT_MODE_FAULT" },
      { number: 253, description: "JOINT_MODE_RUNNING" },
      { number: 255, description: "JOINT_MODE_IDLE" },
    ];
  }

  getText(num) {
    var res = this.toolModes.filter((mode) => mode.number === num);
    if (res.length > 0) {
      return res[0].description;
    }
    return undefined;
  }
}
exports.toolModes = toolModes;

class safetyModes {
  constructor() {
    this.safetyModes = [
      { number: 11, description: "SAFETY_MODE_UNDEFINED_SAFETY_MODE" },
      { number: 10, description: "SAFETY_MODE_VALIDATE_JOINT_ID" },
      { number: 9, description: "SAFETY_MODE_FAULT" },
      { number: 8, description: "SAFETY_MODE_VIOLATION" },
      { number: 7, description: "SAFETY_MODE_ROBOT_EMERGENCY_STOP" },
      { number: 6, description: "SAFETY_MODE_SYSTEM_EMERGENCY_STOP" },
      { number: 5, description: "SAFETY_MODE_SAFEGUARD_STOP" },
      { number: 4, description: "SAFETY_MODE_RECOVERY" },
      { number: 3, description: "SAFETY_MODE_PROTECTIVE_STOP" },
      { number: 2, description: "SAFETY_MODE_REDUCED" },
      { number: 1, description: "SAFETY_MODE_NORMAL" },
    ];
  }

  getText(num) {
    var res = this.safetyModes.filter((mode) => mode.number === num);
    if (res.length > 0) {
      return res[0].description;
    }
    return undefined;
  }
}
exports.safetyModes = safetyModes;
