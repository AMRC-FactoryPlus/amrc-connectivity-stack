/* AMRC Connectivity Stack
 * TP Link Smartplug driver
 * Copyright 2024 AMRC
 */

import { Buffer } from 'node:buffer';
import tplink from 'tplink-smarthome-api';

class TplinkHandler {
    constructor (driver, conf) {
        this.driver = driver;
        this.conf = conf;

        this.log = driver.debug.bound("tcplink");

        this.client = new tplink.Client();
    }

    async run () {
        console.log("run")
        const { driver, client } = this;
        const { host, timeout } = this.conf;

        const device = await client.getDevice(
            { host },
            { timeout }
        )
            .catch(() => null);

        console.log(`PLUG: Device ${host} connected`);

        if (device) 
            driver.setStatus("UP");
        else 
            driver.setStatus("CONN");

        this.device = device;
    }

    parseAddr (spec) {
        switch (spec) {
            case 'SysInfo':
            case 'PowerState':
            case 'InUse':
            case 'Meter':
                return spec
            default:
                return;
        }
    }

    async poll (addr) {
        const { device } = this;
        if (!device) return;

        const convert = value => 
            Buffer.from(JSON.stringify(value));

        switch (addr) {
            case 'SysInfo':
                const value = await device.getSysInfo();
                console.log("SysInfo read %o", value);
                return convert(value);
            case 'PowerState':
                return convert(await device.getPowerState());
            case 'InUse':
                return convert(await device.getInUse());
            case 'Meter': {
                const value = await device.emeter.getRealtime();
                console.log("Meter read %o", value);
                return convert(value);
            }
        }
    }
}

export function tplinkHandler (driver, conf) {
    console.log("Handler called: conf %o", conf)
    if (conf.host == null)
        return;
    const h = new TplinkHandler(driver, conf);
    console.log("h is ", h)
    h.run();
    return h;
}
