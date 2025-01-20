/*
 * Factory+ visualiser.
 * Active packet class.
 * Copyright 2022 AMRC.
 */

function interp (from, to, by) {
    const rv = [
        from[0]*(1 - by) + to[0]*by,
        from[1]*(1 - by) + to[1]*by,
    ];
    return rv;
}

export default class Packet {
    constructor (vis, node, style, stopping) {
        this.vis = vis;
        this.node = node;
        this.style = style;
        this.stopping = stopping;
    }

    render (time, circle) {
        if (!this.start) this.start = time;
        let dT = (time - this.start) / 700;
    
        if (dT > 1) {
            if (this.stopping)
                return false;
            this.node = this.node.parent;
            if (!this.node.parent)
                return false;
            this.start = time;
            dT = 0;
        }

        const pos = interp(this.node.centre, this.node.parent.centre, dT);
        circle(...pos, this.vis.packet_size, this.style);
        return true;
    }
}
