const int64 = require("node-int64");
const urState = require("./urState");

class ur {
  constructor() {
    this.jointModes = new urState.jointModes();
    this.robotModes = new urState.robotModes();
    this.controlMode = new urState.controlModes();
    this.toolMode = new urState.toolModes();
    this.safetyMode = new urState.safetyModes();
  }

  onData(data) {
    let offset = 0;
    let packetSize = data.readInt32BE(offset);
    offset = offset + 4;
    let msgType = data.readByteBE(offset);
    offset = offset + 1;
    let state = new urState.urState();
    if (msgType === 16) {
      while (offset < packetSize - 5) {
        let subPacketStart = offset;
        let subPacketLength = data.readInt32BE(offset);
        offset = offset + 4;
        let subPacketType = data.readByteBE(offset); //Robot State Packages
        offset = offset + 1;
        state.initRobotStatePacket(subPacketType);
        try {
          switch (subPacketType) {
            case 0: // Robot Mode Data
              state.robotModeData.timestamp = data.readInt64BE(offset);
              offset = offset + 8;
              state.robotModeData.physicalRobotConnected =
                data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.realRobotEnabled = data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.robotPowerOn = data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.emergencyStopped = data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.protectiveStopped =
                data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.programRunning = data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.programPaused = data.readBooleanBE(offset);
              offset = offset + 1;
              state.robotModeData.robotMode = data.readByteBE(offset);
              state.robotModeData.robotModeDescription =
                this.robotModes.getText(data.readByteBE(offset));
              offset = offset + 1;
              state.robotModeData.controlMode = data.readByteBE(offset);
              state.robotModeData.controlModeDescription =
                this.controlMode.getText(data.readByteBE(offset));
              offset = offset + 1;
              state.robotModeData.targetSpeedFraction =
                data.readDoubleBE(offset);
              offset = offset + 8;
              state.robotModeData.speedScaling = data.readDoubleBE(offset);
              offset = offset + 8;
              state.robotModeData.targetSpeedFractionLimit =
                data.readDoubleBE(offset);
              offset = offset + 8;
              offset = offset + 1;
              offset = subPacketStart + subPacketLength;
              break;
            case 1: // Joint Data;
              for (let i = 0; i < state.jointData.length; i++) {
                state.jointData[i].codeId = i;
                state.jointData[i].positionActual = data.readDoubleBE(offset);
                state.jointData[i].positionActualDegree =
                  (state.jointData[i].positionActual * 180) / Math.PI;
                offset = offset + 8;
                state.jointData[i].positionTarget = data.readDoubleBE(offset);
                state.jointData[i].positionTargetDegree =
                  (state.jointData[i].positionTarget * 180) / Math.PI;
                offset = offset + 8;
                state.jointData[i].speedActual = data.readDoubleBE(offset);
                offset = offset + 8;
                state.jointData[i].currentActual = data.readFloatBE(offset);
                offset = offset + 4;
                state.jointData[i].voltageActual = data.readDoubleBE(offset);
                offset = offset + 4;
                state.jointData[i].motorTemperature = data.readFloatBE(offset);
                offset = offset + 4;
                offset = offset + 4;
                state.jointData[i].mode = data.readByteBE(offset);
                state.jointData[i].modeDescription = this.jointModes.getText(
                  data.readByteBE(offset)
                );
                offset = offset + 1;
              }
              offset = subPacketStart + subPacketLength;
              break;
            case 2: //Tool Data
              state.toolData.analogInputRange0 = data.readByteBE(offset);
              offset = offset + 1;
              state.toolData.analogInputRange1 = data.readByteBE(offset);
              offset = offset + 1;
              state.toolData.analogIn0 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.toolData.analogIn1 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.toolData.toolVoltage48V = data.readFloatBE(offset);
              offset = offset + 4;
              state.toolData.toolOutputVoltage = data.readByteBE(offset);
              offset = offset + 1;
              state.toolData.toolCurrent = data.readFloatBE(offset);
              offset = offset + 4;
              state.toolData.toolTemperature = data.readFloatBE(offset);
              offset = offset + 4;
              state.toolData.mode = data.readByteBE(offset);
              state.toolData.modeDescription = this.toolMode.getText(
                data.readByteBE(offset)
              );
              offset = offset + 1;
              offset = subPacketStart + subPacketLength;
              break;
            case 3: //Masterboard Data
              state.masterboardData.digitalInputBits = data.readInt32BE(offset);
              offset = offset + 4;
              state.masterboardData.digitalOutputBits =
                data.readInt32BE(offset);
              offset = offset + 4;
              state.masterboardData.analogInputRange0 = data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.analogInputRange1 = data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.analogIn0 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.masterboardData.analogIn1 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.masterboardData.analogOutputDomain0 =
                data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.analogOutputDomain1 =
                data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.analogOut0 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.masterboardData.analogOut1 = data.readDoubleBE(offset);
              offset = offset + 8;
              state.masterboardData.temperature = data.readFloatBE(offset);
              offset = offset + 4;
              state.masterboardData.robotVoltage48V = data.readFloatBE(offset);
              offset = offset + 4;
              state.masterboardData.robotCurrent = data.readFloatBE(offset);
              offset = offset + 4;
              state.masterboardData.masterIOCurrent = data.readFloatBE(offset);
              offset = offset + 4;
              state.masterboardData.safetymode = data.readByteBE(offset);
              state.masterboardData.safetymodeDescription =
                this.safetyMode.getText(data.readByteBE(offset));
              offset = offset + 1;
              state.masterboardData.inReduceMode = data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.euromap67installed =
                data.readByteBE(offset);
              offset = offset + 1;
              if (state.masterboardData.euromap67installed > 0) {
                state.masterboardData.euromapInputBits =
                  data.readInt32BE(offset);
                offset = offset + 4;
                state.masterboardData.euromapOutputBits =
                  data.readInt32BE(offset);
                offset = offset + 4;
                state.masterboardData.euromapVoltage = data.readFloatBE(offset);
                offset = offset + 4;
                state.masterboardData.euromapCurrent = data.readFloatBE(offset);
                offset = offset + 4;
              }
              offset = offset + 4;
              state.masterboardData.operationalModeSelectorInput =
                data.readByteBE(offset);
              offset = offset + 1;
              state.masterboardData.threePositionEnablingDeviceInput =
                data.readByteBE(offset);
              offset = offset + 1;
              offset = subPacketStart + subPacketLength;
              break;

            case 4: //Cartesian Info
              state.cartesianInfo.toolVectorX = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.toolVectorY = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.toolVectorZ = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.toolRx = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.toolRy = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.toolRz = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetX = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetY = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetZ = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetRx = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetRy = data.readDoubleBE(offset);
              offset = offset + 8;
              state.cartesianInfo.tcpOffsetRz = data.readDoubleBE(offset);
              offset = offset + 8;
              break;
            case 5: // Calibration Data should be skipped
              offset = subPacketStart + subPacketLength;
              break;
            case 6: //Configuration Data
              for (let i = 0; i < 6; i++) {
                state.configData.jointLimits[i].jointMinLimit =
                  data.readDoubleBE(offset);
                offset = offset + 8;
                state.configData.jointLimits[i].jointMaxLimit =
                  data.readDoubleBE(offset);
                offset = offset + 8;
              }
              for (let i = 0; i < 6; i++) {
                state.configData.jointMaxValues[i].jointMaxSpeed =
                  data.readDoubleBE(offset);
                offset = offset + 8;
                state.configData.jointMaxValues[i].jointMaxAcceleration =
                  data.readDoubleBE(offset);
                offset = offset + 8;
              }
              state.configData.defaultSpeedLimit = data.readDoubleBE(offset);
              offset = offset + 8;
              state.configData.defaultAccelerationLimit =
                data.readDoubleBE(offset);
              offset = offset + 8;
              state.configData.defaultToolSpeedLimit =
                data.readDoubleBE(offset);
              offset = offset + 8;
              state.configData.defaultToolAccelerationLimit =
                data.readDoubleBE(offset);
              offset = offset + 8;
              state.configData.characteristicSizeTool =
                data.readDoubleBE(offset);
              offset = offset + 8;
              for (let i = 0; i < 6; i++) {
                state.configData.jointDHa[i] = data.readDoubleBE(offset);
                offset = offset + 8;
              }
              for (let i = 0; i < 6; i++) {
                state.configData.jointDHd[i] = data.readDoubleBE(offset);
                offset = offset + 8;
              }
              for (let i = 0; i < 6; i++) {
                state.configData.jointDHalpha[i] = data.readDoubleBE(offset);
                offset = offset + 8;
              }
              for (let i = 0; i < 6; i++) {
                state.configData.jointDHthetha[i] = data.readDoubleBE(offset);
                offset = offset + 8;
              }
              state.configData.masterboardVersion = data.readInt32BE(offset);
              offset = offset + 4;
              state.configData.controllerBoxType = data.readInt32BE(offset);
              offset = offset + 4;
              state.configData.robotType = data.readInt32BE(offset);
              offset = offset + 4;
              state.configData.robotSubType = data.readInt32BE(offset);
              offset = offset + 4;
              offset = subPacketStart + subPacketLength;
              break;
            case 7: //Force Mode Frame
              state.forceModeFrame.xValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.yValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.zValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.rxValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.ryValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.rzValue = data.readDoubleBE(offset);
              offset = offset + 8;
              state.forceModeFrame.robotDexterity = data.readDoubleBE(offset);
              offset = offset + 8;
              offset = subPacketStart + subPacketLength;
              break;
            case 8: //Additional Info
              state.additionalInfo.freedriveButtonPressed =
                data.readBooleanBE(offset);
              offset = offset + 1;
              state.additionalInfo.freedriveButtonEnabled =
                data.readBooleanBE(offset);
              offset = offset + 1;
              state.additionalInfo.ioEnabledFreedrive =
                data.readBooleanBE(offset);
              offset = offset + 1;
              offset = offset + 1;
              offset = subPacketStart + subPacketLength;
              break;
            case 9: // Calibration Data should be skipped
              offset = subPacketStart + subPacketLength;
              break;
            case 10: // Safety Data should be skipped
              offset = subPacketStart + subPacketLength;
              break;
            case 11: // Tool communication Data should be skipped
              state.toolCommunicationInfo.enabled = data.readBooleanBE(offset);
              offset = offset + 1;
              state.toolCommunicationInfo.baudrate = data.readInt32BE(offset);
              offset = offset + 4;
              state.toolCommunicationInfo.parity = data.readInt32BE(offset);
              offset = offset + 4;
              state.toolCommunicationInfo.rxIdleChars =
                data.readInt32BE(offset);
              offset = offset + 4;
              state.toolCommunicationInfo.txIdleChars =
                data.readInt32BE(offset);
              offset = offset + 4;
              offset = subPacketStart + subPacketLength;
              break;
            default:
              offset = subPacketStart + subPacketLength;
              break;
          }
        } catch (error) {
          console.error(error);
          return undefined;
        }
      }
      return state;
    }
  }
}

module.exports = ur;

(function () {
  Buffer.prototype.readInt64BE = function (offset) {
    return new int64(this, offset).toNumber(true);
  };
  Buffer.prototype.readBooleanBE = function (offset) {
    return this[offset] == 1;
  };
  Buffer.prototype.readByteBE = function (offset) {
    return this[offset];
  };
})();
