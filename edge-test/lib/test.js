/*
 * Edge Agent testing driver
 * Copyright 2024 AMRC
 */

const funcs = {
    const:  (p, a) => t => a,
    sin:    (p, a) => t => a * Math.sin(2 * Math.PI * (t / p)),
    saw:    (p, a) => t => (a / p) * (t % p),
};
const packing = {
    bd:     [8, (b, v) => b.writeDoubleBE(v)],
    ld:     [8, (b, v) => b.writeDoubleLE(v)],
    bf:     [4, (b, v) => b.writeFloatBE(v)],
    lf:     [4, (b, v) => b.writeFloatLE(v)],
};

class TestHandler {
    constructor (driver) {
        this.driver = driver;
    }

    run () {
        this.driver.setStatus("UP");
    }

    parseAddr (spec) {
        const parts = spec.split(":");
        if (parts.length != 4) return;

        const func = funcs[parts[0]];
        if (!func) return;
        const period = Number.parseFloat(parts[1]);
        if (Number.isNaN(period)) return;
        const amplitude = Number.parseFloat(parts[2]);
        if (Number.isNaN(amplitude)) return;
        const pack = packing[parts[3]];
        if (!pack) return;

        return {
            func:   func(period, amplitude),
            size:   pack[0],
            pack:   pack[1],
        };
    }

    async poll (addr) {
        const val = addr.func(performance.now());
        const buf = Buffer.alloc(addr.size);
        addr.pack(buf, val);

        return buf;
    }
}

export function handleTest (driver, conf) {
    return new TestHandler(driver);
}
