/*
 * Edge Agent testing driver
 * Test addresses: parsing and the canonical form
 * Copyright 2026 University of Sheffield
 *
 * An address is function:period:amplitude:packing, such as
 * sin:3000:50:bd. The canonical form writes both numbers as
 * JavaScript prints them, so sin:3000.0:50:bd becomes sin:3000:50:bd.
 * Edge Scout lists every address in this form.
 */

export const funcs = {
    const:  (p, a) => t => a,
    sin:    (p, a) => t => a * Math.sin(2 * Math.PI * (t / p)),
    saw:    (p, a) => t => (a / p) * (t % p),
};
export const packing = {
    bd:     [8, (b, v) => b.writeDoubleBE(v)],
    ld:     [8, (b, v) => b.writeDoubleLE(v)],
    bf:     [4, (b, v) => b.writeFloatBE(v)],
    lf:     [4, (b, v) => b.writeFloatLE(v)],
};

/* Split an address into its parts, or return undefined when it is
 * not a valid address. */
export function split_addr (spec) {
    if (typeof spec != "string") return;
    const parts = spec.split(":");
    if (parts.length != 4) return;

    const [func, p, a, pack] = parts;
    if (!Object.hasOwn(funcs, func)) return;
    const period = Number.parseFloat(p);
    if (Number.isNaN(period)) return;
    const amplitude = Number.parseFloat(a);
    if (Number.isNaN(amplitude)) return;
    if (!Object.hasOwn(packing, pack)) return;

    return { func, period, amplitude, pack };
}

/* The canonical form of an address, or undefined when it is not a
 * valid address. */
export function canonical_addr (spec) {
    const parts = split_addr(spec);
    if (!parts) return;
    const { func, period, amplitude, pack } = parts;
    return `${func}:${period}:${amplitude}:${pack}`;
}
