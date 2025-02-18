/*
 * Copyright (c) University of Sheffield AMRC 2024.
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

  async cmd (address, data) {

    // address: selectPset
    // BufferX.to(data): { pSet: 14 }

    // BEFORE CLOSE -
    // - Make library subscribe to cmds
    // - Implement BufferX.from...

    this.log('CMD', address, data)
    switch (address) {
      case 'selectPset':
        const parameterSetID = BufferX.fromUInt8(data);
        this.client.command('selectPset', { payload: { parameterSetID } })
    }
  }

  async close () {

  }
}