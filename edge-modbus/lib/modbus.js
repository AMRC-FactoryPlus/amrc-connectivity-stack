/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import ModbusRTU from "modbus-serial";

const RECONNECT = 5000;

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

export class ModbusHandler {
    constructor (driver, conf) {
        this.driver = driver;
        this.conf = conf;

        this.log = driver.debug.bound("modbus");
        this.on_close = () => {
            this.log("Modbus connection closed");
            driver.connFailed();
        };

        this.client = new ModbusRTU();
        this.client.on("close", this.on_close);
    }

    static create (driver, conf) {
        if (conf.protocol != "tcp")
            return;
        return new ModbusHandler(driver, conf);
    }
    
    connect () {
        const { driver, client } = this;
        const { host, port } = this.conf;

        return client.connectTCP(host, { port })
            .then(() => "UP")
            .catch(() => "CONN");
    }

    close () {
        const { client } = this;
        
        client.off("close", this.on_close);
        return new Promise(r => client.close(r));
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

        if (!client.isOpen) return;

        client.setID(addr.id);
        const val = await addr.func.read(client, addr.addr, addr.len);
        return val.buffer;
    }
}
