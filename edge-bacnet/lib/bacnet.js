/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import bacnet from 'node-bacnet';
import { BufferX } from '@amrc-factoryplus/edge-driver'

export class BacnetHandler {
  constructor (driver, conf) {
    this.driver = driver
    this.conf   = conf
    this.log = driver.debug.bound('bacnet')

    const {
            listenInterface,
            port,
            broadcastAddress,
            apduTimeout,
          } = conf

    this.client = new bacnet({
      port: port,
      interface: listenInterface,
      broadcastAddress: broadcastAddress,
      apduTimeout: apduTimeout,
    })
  }

  static create (driver, conf) {
    return new BacnetHandler(driver, conf)
  }

  connect () {
    // This is a stateless protocol, so we don't need to wait for
    // the connection to be established
    return 'UP'
  }

  parseAddr (spec) {

    // XXX - This is a hack and shouldn't need to handle this at all.
    // This originates from an upstream edge agent bug.
    if (spec === 'undefined') {
      return {
        type: null,
        instance: null,
        propertyId: null,
      }
    }

    const parts = spec.split(',')

    // If there are three parts, then the last one is the propertyID. If
    // it is missing then the propertyId is 85

    const type = Number.parseInt(parts[0])
    if (Number.isNaN(type) || type < 0) return

    const instance = Number.parseInt(parts[1])
    if (Number.isNaN(instance) || instance < 0) return

    const propertyId = Number.parseInt(parts[2] || '85')

    return {
      type,
      instance,
      propertyId,
    }
  }

  async poll (addr) {

    const { client } = this

    // XXX - This is a hack and shouldn't need to handle this at all.
    // This originates from an upstream edge agent bug.
    if (addr.type === null) {
      return;
    }

    return new Promise((resolve, reject) => {

      // XXX - It would be nice to support readPropertyMultiple in the
      // future when the driver library supports it
      client.readProperty(this.conf.host, {
        type: addr.type,
        instance: addr.instance,
      }, addr.propertyId, (err, value) => {
        if (err) {
          this.log('Error reading property %o: %o', addr, err)
          resolve(undefined)
        }
        else {
          const buffer = BufferX.fromJSON(value.values[0])
          resolve(buffer)
        }
      })
    })
  }
}
