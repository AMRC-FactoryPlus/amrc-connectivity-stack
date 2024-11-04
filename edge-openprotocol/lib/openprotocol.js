/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { createClient } from 'node-open-protocol'

/* This is the handler interface */
class OpenProtocolHandler {

  /* The constructor is private */
  constructor (driver, conf) {
    this.driver = driver
    this.conf   = conf
    this.log    = driver.debug.bound('open-protocol')
  }

  /* This is called to create a handler */
  static create (driver, conf) {}

  /* Methods required by Driver */
  connect () {

    const host = this.conf.host
    const port = this.conf.port ?? 4545

    createClient(port, host, null, (data) => {
      const deviceInfo = JSON.stringify(data)
      this.log(`OpenProtocol connection established with ${host}:${port}. Gave MID 0002 of ${deviceInfo}`)
      return 'UP'
    })
  }

  parseAddr (addr) {

  }

  subscribe (specs) {

  }

  async close () {

  }
}