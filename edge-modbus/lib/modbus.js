/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import ModbusRTU from "modbus-serial";

const funcs = {
    input:      { 
        read:   (c, a, l) => c.readInputRegisters(a, l),
    },
    holding:    {
        read:   (c, a, l) => c.readHoldingRegisters(a, l),
    },
    coil:       {
        read:   (c, a, l) => c.readCoils(a, l),
    },
    discrete:   {
        read:   (c, a, l) => c.readDiscreteInputs(a, l),
    },
};

class ModbusHandler {
    constructor (driver, conf) {
        this.driver = driver;
        this.conf = conf;
        this.client = new ModbusRTU();
    }

    run () {
        const { client, driver } = this;
        const { host, port } = this.conf;

        client.connectTCP(host, { port })
            .then(() => driver.setStatus("UP"))
            .catch(() => driver.setStatus("CONN"));
    }

    parseAddr (spec) {
        const parts = spec.split(",");
        if (parts.length != 4) return;

        const id = Number.parseInt(parts[0]);
        if (Number.isNaN(id) || id < 0) return;
        const func = funcs[parts[1]];
        if (!func) return;
        const addr = Number.parseInt(parts[2]);
        if (Number.isNaN(addr) || addr < 0) return;
        const len = Number.parseInt(parts[3]);
        if (Number.isNaN(len) || len < 1) return;

        return { id, func, addr, len };
    }

    async poll (addr) {
        const { client } = this;

        if (!client.isOpen) {
            const st = await new Promise((r, j) => 
                client.open(e => {
                    console.log("Modbus open: %s", e);
                    r(e ? "CONN" : "UP");
                }));
            this.driver.setStatus(st);
            if (st != "UP") return;
        }

        client.setID(addr.id);
        const val = await addr.func.read(client, addr.addr, addr.len);
        return val.buffer;
    }
}

export function modbusHandler (driver, conf) {
    if (conf.protocol != "tcp")
        return;
    return new ModbusHandler(driver, conf);
}
