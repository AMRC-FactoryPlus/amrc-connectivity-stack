/*
 * Factory+ visualisation.
 * Vis display class.
 * Copyright 2022 AMRC.
 */

import Packet from "./packet.js";
import Style from "./style.js";

const TURN = 2*Math.PI;
const HALF = Math.PI;
const QUARTER = Math.PI/2;
const FADEOUT = 15000;

function fade (expires, now) {
    const rv = 0.2 + Math.min(0.8, Math.max(0, (expires - now)/FADEOUT));
    return rv;
}

export default class Vis {
    constructor (graph, canvas, icons) {
        this.graph = graph;
        this.canvas = canvas;
        this.icons = icons;

        this.render = this.render.bind(this);
        this.circle = this.circle.bind(this);

        const obs = new ResizeObserver(() => this.resize());
        obs.observe(this.canvas);
        this.resize();
    }

    circle (x, y, r, fill_style, stroke) {
        const ctx = this.ctx;
        if (fill_style) ctx.fillStyle = Style[fill_style];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TURN, true);
        ctx.fill()
        if (stroke) ctx.stroke();
    }

    count_leaves (graph, depth) {
        graph.depth = depth;
        const nodes = graph.children ?? [];

        if (graph.path)
            this.paths.set(graph.path, graph);

        if (!nodes.length) {
            this.leaves.push(graph);
            graph.kids = 0;
            graph.leaves = 1;
            graph.maxdepth = 0;
            return;
        }

        nodes.forEach(c => {
            this.count_leaves(c, depth + 1);
            c.parent = graph;
        });

        const devs = nodes.filter(n => !n.is_cmd);
        const cmds = nodes.filter(n => n.is_cmd);

        if (devs.every(n => !n.children) && devs.length > 5) {
            graph.render = [
                { is_o

            graph.too_many = true;
            graph.leaves = graph.kids = cmds.length + 1;
            graph.maxdepth = cmds.length ? 1 : 0;
            return;
        }

        graph.too_many = false;
        graph.kids = nodes.length;
        graph.leaves = nodes
            .map(c => c.leaves)
            .reduce((a, b) => a + b, 0);
        graph.maxdepth = 1 + nodes
            .map(c => c.maxdepth)
            .reduce((a,b) => a > b ? a : b, 0);
    }

    pick_centres (graph, angle, radius, segment, ring) {
        const myangle = angle + segment * graph.leaves / 2;
        const jitter = (Math.random() - 0.5) * 0.6 * ring;
        const centre = graph.centre = [
            (radius + jitter) * Math.cos(myangle) * this.xscale, 
            (radius + jitter) * Math.sin(myangle)];
        const txtangle = myangle + 1;
        graph.radius = this.root_node/(graph.depth + 3);

        const name_w = this.ctx.measureText(graph.name).width;
        graph.label = [
            name_w/2,
            0,
            //graph.depth == 0 ? 0 :
            //    (txtangle > TURN/4 && txtangle < 3*TURN/4)
            //        ? txtangle - TURN/2 : txtangle,
        ];
        
        if (graph.too_many) {
            const o_cen = [
                (radius + ring) * Math.cos(myangle) * this.xscale, 
                (radius + ring) * Math.sin(myangle),
            ];
            graph.overflow = {
                parent: graph,
                centre: o_cen,
            };
        }
        
        const nodes = graph.too_many
            ? graph.children.filter(

        if (graph.too_many || !nodes || nodes.length == 0)
             return;

        for (const child of nodes) {
            this.pick_centres(child, angle, radius + ring, segment, ring);
            angle += segment * child.leaves;
        }
    }

    render_nodes (graph, now) {
        const ctx = this.ctx;

        if (graph.children) {
            if (graph.too_many)
                this.render_too_many(graph);
            else
                this.render_children(graph, now);
        }

        const pos = graph.centre;
        const icon = this.icons.fetch_icon(graph.schema);

        ctx.save()
        if (graph.expires)
            ctx.globalAlpha = fade(graph.expires, now);
        if (icon) {
            const r = 0.3*this.root_node;
            graph.text_roff = r;
            ctx.strokeStyle = graph.online ? Style.circles : Style.offline;
            ctx.lineWidth = 4;
            ctx.fillStyle = Style.background;
            ctx.translate(pos[0], pos[1]);
            this.circle(0, 0, r, null, true);

            ctx.fillStyle = Style.text;
            const scale = r * icon.scale;
            ctx.scale(scale, scale);
            ctx.translate(...icon.offset);
            ctx.fill(icon.path);
        }
        else {
            graph.text_roff = graph.radius;
            const style = graph.is_cmd ? "CMD" : graph.online ? "circles" : "offline";
            this.circle(pos[0], pos[1], graph.radius, style);
        }
        ctx.restore();
    }

    render_children (graph, now) {
        const ctx = this.ctx;

        for (const n of graph.children) {
            if (!n.centre) {
                console.log("No centre for %o", n);
                continue;
            }
            if (n.is_cmd) 
                ctx.strokeStyle = Style.CMD;
            else 
                ctx.strokeStyle = Style.circles;
            ctx.beginPath();
            ctx.moveTo(...graph.centre);
            ctx.lineTo(...n.centre);
            ctx.stroke();
            this.render_nodes(n, now);
        }
    }

    render_too_many (graph) {
        const ctx = this.ctx;

        ctx.save()
        ctx.beginPath();
        ctx.moveTo(...graph.centre);
        ctx.lineTo(...graph.overflow.centre);
        ctx.strokeStyle = Style.circles;
        ctx.stroke();
        ctx.lineWidth = 3 * this.line_width;

        const [x, y] = graph.overflow.centre;
        const r = 0.35*this.root_node;
        ctx.strokeStyle = Style.background;
        ctx.fillStyle = Style.background;
        this.circle(x, y, r, null, false);

        const nodes = graph.children;
        const devs = nodes.filter(n => !n.is_cmd);
        const cmds = nodes.filter(n => n.is_cmd);

        const th = TURN / devs.length;
        for (let i = 0; i < devs.length; i++) {
            ctx.strokeStyle = devs[i].online ? Style.circles : Style.offline;
            const [st, en] = [th*i, th*(i + 1)];
            ctx.beginPath();
            ctx.arc(x, y, r, st, en, false);
            ctx.stroke();
        }

        ctx.restore();
    }

    render_text (graph, now) {
        const ctx = this.ctx;

        if (graph.label) {
            const [offset, angle] = graph.label;
            const print = (fill, size, centre, offset, text) => { 
                ctx.save();
                ctx.font = `${size}px ${Style.font}`;
                ctx.fillStyle = fill;
                if (graph.expires)
                    ctx.globalAlpha = fade(graph.expires, now);
                ctx.translate(centre[0], centre[1]);
                //ctx.rotate(-0.5);
                if (offset) {
                    ctx.translate(...offset);
                }
                else {
                    const tsz = ctx.measureText(text);
                    ctx.translate(-(tsz.width / 2), (tsz.actualBoundingBoxAscent / 2));
                }
                ctx.fillText(text, 0, 0);
                ctx.restore();
            };

            const radius = graph.text_roff;
            print(Style.text, this.text_height, 
                graph.centre, [-offset, -radius - 2],
                graph.name);
			
            if (graph.too_many) {
                print(Style.text, (0.4*this.root_node),
                    graph.overflow.centre, null,
                    graph.too_many);
            }
        }

        if (graph.children && !graph.too_many) {
            for (const n of graph.children)
                this.render_text(n, now);
        }
    }
    
    run () {
        this.reset_graph();
        this.active = new Set();

        this.stopping = null;
        window.requestAnimationFrame(this.render);

        return this;
    }

    stop () {
        return new Promise((resolve, reject) =>
            this.stopping = resolve);
    }

    resize () {
        this.ctx = canvas.getContext("2d");

        const margin = 10;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.radius = Math.min(this.width, this.height) / 2 - margin;
        this.xscale = (this.width - 2*margin) / (this.height - 2*margin);
        this.root_node = this.radius / 9;
        this.packet_size = this.radius / 90;
        this.line_width = this.radius / 600;
        this.text_height = this.height / 90;
        this.reset_graph();
    }

    reset_graph () {
        this.leaves = [];
        this.paths = new Map();
        this.count_leaves(this.graph, 0);

        const segment = TURN / this.graph.leaves;
        const ring = this.radius * 0.8 / this.graph.maxdepth;
        this.pick_centres(this.graph, 0, 0, segment, ring);
    }

    make_active (path, style, stopping) {
        let node = this.paths.get(path);
        if (node) {
            if (node.parent.too_many) {
                node = node.parent.overflow;
            }
            this.active.add(new Packet(this, node, style, stopping));
        }
    }

    render (time) {
        if (this.stopping) {
            this.stopping();
            return;
        }

        const ctx = this.ctx;
        const now = Date.now();

        ctx.reset();
        ctx.save();
        ctx.fillStyle = Style.background;;
        ctx.fillRect(0, 0, this.width, this.height);

        ctx.fillStyle = Style.circles;
        ctx.strokeStyle = Style.lines;
        ctx.lineWidth = this.line_width;
        ctx.translate(this.width/2, this.height/2);

        this.render_nodes(this.graph, now);
        this.render_text(this.graph, now);

        for (const [_, p] of this.active.entries()) {
            if (!p.render(time, this.circle))
                this.active.delete(p);
        }

        /*
        ctx.save();
        ctx.font = Style.font;
        ctx.fillStyle = Style.text;
        ctx.fillText(`${this.canvas.width}x${this.canvas.height}`, 0, 0);
        ctx.restore();
        */

        ctx.restore();

        window.requestAnimationFrame(this.render);
    }
};
