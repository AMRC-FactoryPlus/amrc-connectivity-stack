/*
 * ACS Edge Agent
 * Driver fixtures: deterministic values that change over time
 * Copyright 2026 University of Sheffield
 */

/* FNV-1a, to turn a seed and a name into a PRNG seed. */
export function hash (s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/* mulberry32: small, fast and the same on every platform. */
export function rng (seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const INT_RANGE: { [t: string]: [number, number] } = {
    Int8: [-128, 127],
    Int16: [-32768, 32767],
    Int32: [-2147483648, 2147483647],
    Int64: [-1e12, 1e12],
    UInt8: [0, 255],
    UInt16: [0, 65535],
    UInt32: [0, 4294967295],
    UInt64: [0, 1e12],
};

const STATES = ["IDLE", "RUNNING", "STOPPED", "SETUP", "ALARM", "READY"];

/* Fixture time 0 maps to this instant for DateTime values. */
export const EPOCH = Date.UTC(2026, 0, 1);

export function supported_type (type: string): boolean {
    return type in INT_RANGE
        || /^(Float|Double|Boolean|String|Text|UUID|DateTime)$/.test(type);
}

/* A value that changes over time the way a device value of this type
 * does: analogue values every tick, counts and states now and then. A
 * DateTime is ms since the epoch, a UUID a string. next() is called
 * once per tick. */
export class Signal {
    readonly type: string;
    private r: () => number;
    private v: any;
    private n = 0;
    private base = 0;
    private amp = 0;
    private period = 1;

    /* range is the metric's engineering range, if it has one. */
    constructor (type: string, seed: number, range?: [number, number]) {
        this.type = type;
        this.r = rng(seed);
        const r = this.r;
        if (type in INT_RANGE) {
            const [lo, hi] = INT_RANGE[type];
            this.v = Math.round(Math.max(lo, Math.min(hi, lo < 0
                ? (r() - 0.5) * Math.min(hi, 2000)
                : r() * Math.min(hi, 1000))));
        }
        else if (type == "Float" || type == "Double") {
            const [lo, hi] = range ?? [0, 500];
            const span = hi - lo;
            this.amp = span * (0.05 + r() * 0.2);
            this.base = lo + this.amp + r() * (span - 2 * this.amp);
            this.period = 20 + Math.floor(r() * 100);
        }
        else if (type == "Boolean")
            this.v = r() < 0.5;
        else if (type == "UUID")
            this.v = this.uuid();
        else if (type == "DateTime")
            this.v = EPOCH;
        else
            this.v = STATES[Math.floor(r() * STATES.length)];
    }

    /* The value at the next tick, and whether it changed. */
    next (t: number): any {
        const r = this.r;
        const first = this.n++ == 0;
        switch (this.type) {
            case "Float":
            case "Double": {
                const x = this.base
                    + this.amp * Math.sin(2 * Math.PI * this.n / this.period)
                    + (r() - 0.5) * this.amp * 0.05;
                /* A Float is 32-bit on the wire, so keep values a
                 * Float can hold exactly. */
                this.v = this.type == "Float" ? Math.fround(x) : x;
                break;
            }
            case "Boolean":
                if (!first && r() < 0.05) this.v = !this.v;
                break;
            case "DateTime":
                if (first || r() < 0.1) this.v = EPOCH + t;
                break;
            case "UUID":
                if (!first && r() < 0.01) this.v = this.uuid();
                break;
            case "String":
            case "Text":
                if (!first && r() < 0.02)
                    this.v = STATES[Math.floor(r() * STATES.length)];
                break;
            default: {
                if (first || r() > 0.3) break;
                const [lo, hi] = INT_RANGE[this.type];
                const step = Math.floor(r() * 5) + 1;
                const up = this.v + step <= hi && (r() < 0.6 || this.v - step < lo);
                this.v = up ? this.v + step : this.v - step;
            }
        }
        return this.v;
    }

    private uuid (): string {
        const h = () => Math.floor(this.r() * 0x10000)
            .toString(16).padStart(4, "0");
        return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`;
    }
}
