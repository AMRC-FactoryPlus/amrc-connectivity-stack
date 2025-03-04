/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import pkg from 'node-open-protocol-desoutter'
import { BufferX } from '@amrc-factoryplus/edge-driver'

const { createClient } = pkg

/* This is the handler interface */
export class OpenProtocolHandler {

  /* The constructor is private */
  constructor (driver, conf) {
    this.driver = driver
    this.conf   = conf
    this.log    = driver.debug.bound('open-protocol')
  }

  static validAddresses = new Set([
    'psetSelected',
    'lockAtBatchDoneUpload',
    'jobInfo',
    'vin',
    'lastTightening',
    'alarm',
    'alarmStatus',
    'alarmAcknowledged',
    'multiSpindleStatus',
    'multiSpindleResult',
    'lastPowerMACSTighteningResultStationData',
    'jobLineControl',
    'multipleIdentifierResultParts',
    'statusExternallyMonitoredInputs',
    'relayFunction',
    'digitalInputFunction',
    'userData',
    'selectorSocketInfo',
    'toolTagID',
    'automaticManualMode',
    'openProtocolCommandsDisabled',
    'motorTuningResultData',
  ])

  /* This is called to create a handler */
  static create (driver, conf) {
    return new OpenProtocolHandler(driver, conf)
  }

  /* Methods required by Driver */
  connect () {

    const host = this.conf.host
    const port = this.conf.port ?? 4545

    this.log('Connecting to Open Protocol', host, port)

    this.client = createClient(port, host, null, (data) => {
      this.log('Connected to Open Protocol')
      this.driver.connUp()

      // This is debug
      // this.client.command('enableTool')
      // this.client.command('selectPset', { payload: { parameterSetID: 11 } })

    })

    this.client.on('error', (err) => {
      this.log('Error connecting to Open Protocol')
      this.driver.connFailed()
    })

    OpenProtocolHandler.validAddresses.forEach(address => {
      this.client.on(address, (midData) => {
        this.log(midData)
        this.driver.data(address, BufferX.fromJSON(midData))
      })
    })
  }

  async subscribe (specs) {

    this.log(specs)

    const promises = specs.map(addressFromManager => new Promise((resolve, reject) => {

      // If the address is not in the valid addresses, skip it
      if (!OpenProtocolHandler.validAddresses.has(addressFromManager)) {
        this.log('Invalid address', addressFromManager)
        resolve()
        return
      }

      this.client.subscribe(addressFromManager, (err, data) => {
        if (err) {
          this.log('Error subscribing to Open Protocol', err)
          reject(err)
        }
        else {
          this.log(`Subscribed to ${addressFromManager}`)
          resolve()
        }
      })
    }))

    try {
      await Promise.all(promises)
      return true
    }
    catch (err) {
      this.log('Error subscribing to Open Protocol', err)
      return false
    }

  }

  async cmd (commandName, data) {

    switch (commandName) {
    case 'selectPset':
      const parameterSetID = BufferX.toUInt8(data)
      this.client.command('selectPset', { payload: { parameterSetID } })
      break
    case 'enableTool':
      const value = BufferX.toUInt8(data)
      if (value === 1) {
        this.client.command('enableTool')
      }
      else {
        this.client.command('disableTool')
      }
      break
    default:
      // Throw error
      this.log(`The ${commandName} command is not supported in this version of the driver`)
      break
    }
  }

  async close () {

  }
}