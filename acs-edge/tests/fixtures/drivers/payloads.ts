/*
 * ACS Edge Agent
 * Driver fixtures: payloads in which configured paths resolve
 *
 * Each builder works backwards from the metric paths on one address
 * (a topic or a URL path) to a payload in which every path points at
 * its own slot. render() then fills the slots with the values for one
 * moment in time. The generator checks the result with the Edge
 * Agent's own parser, so these only have to build the right shape.
 * Copyright 2026 University of Sheffield
 */

import type { ReadMetric } from "./metrics.js";

export interface PayloadDoc {
    content_type: string,
    /* Reserve a slot for this path. Returns the slot number, or a
     * string saying why the path cannot be satisfied. The metric is
     * given for formats whose layout depends on its type. */
    place (path: string, m?: ReadMetric): number | string,
    /* The payload as text, or as base64 if `binary` is set. */
    render (values: any[], types: string[]): string,
    binary?: boolean,
}

/* A value as text, the way a device would print it. */
function as_text (v: any, type: string): string {
    if (type == "DateTime") return new Date(v).toISOString();
    return String(v);
}

/* ---------------------------------------------------------------- */
/* JSON                                                              */

type JStep =
    | { kind: "key", key: string }
    | { kind: "index", index: number }
    | { kind: "filter", field: string, value: any };

/* Parse the JSONPath subset that can be inverted: $, .key, ['key'],
 * [n] and [?(@.field == literal)]. Returns a string for anything else
 * (wildcards, recursive descent, slices, scripts). */
export function parse_jsonpath (path: string): JStep[] | string {
    if (!path.startsWith("$"))
        return `JSONPath "${path}" does not start with $`;
    const steps: JStep[] = [];
    let i = 1;
    const fail = (why: string) =>
        `JSONPath "${path}": ${why} at character ${i}, which the generator cannot invert`;
    while (i < path.length) {
        const c = path[i];
        if (c == ".") {
            if (path[i + 1] == ".") return fail("recursive descent (..)");
            const m = /^[^.[\]]+/.exec(path.slice(i + 1));
            if (!m) return fail("empty key");
            if (m[0] == "*") return fail("wildcard");
            steps.push({ kind: "key", key: m[0] });
            i += 1 + m[0].length;
        }
        else if (c == "[") {
            const rest = path.slice(i);
            let m;
            if ((m = /^\[\s*(['"])(.*?)\1\s*\]/.exec(rest))) {
                steps.push({ kind: "key", key: m[2] });
            }
            else if ((m = /^\[\s*(\d+)\s*\]/.exec(rest))) {
                steps.push({ kind: "index", index: parseInt(m[1]) });
            }
            else if ((m = /^\[\?\(\s*@\.([A-Za-z_$][\w$]*)\s*===?\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*\)\]/.exec(rest))) {
                const value = m[2] ?? m[3]
                    ?? (m[4] != null ? Number(m[4]) : m[5] == "true");
                steps.push({ kind: "filter", field: m[1], value });
            }
            else return fail("unsupported bracket expression");
            i += m[0].length;
        }
        else return fail(`unexpected "${c}"`);
    }
    return steps;
}

/* A slot holds this until render() fills it. */
class Slot { constructor (readonly id: number) {} }

function is_plain (v: any) {
    return typeof v == "object" && v !== null
        && !Array.isArray(v) && !(v instanceof Slot);
}

export class JsonDoc implements PayloadDoc {
    content_type = "application/json";
    private top: any = { root: undefined };
    private slots: { holder: any, key: string | number }[] = [];

    place (path: string): number | string {
        /* No path: Device reads payload.value. */
        const steps = path ? parse_jsonpath(path)
            : [{ kind: "key", key: "value" } as JStep];
        if (typeof steps == "string") return steps;

        let holder: any = this.top;
        let key: string | number = "root";
        for (const s of steps) {
            let cur = holder[key];
            if (s.kind == "key") {
                if (cur === undefined) cur = holder[key] = {};
                if (!is_plain(cur))
                    return `JSONPath "${path}" needs an object where another metric's path put ${describe(cur)}`;
                holder = cur; key = s.key;
            }
            else {
                if (cur === undefined) cur = holder[key] = [];
                if (!Array.isArray(cur))
                    return `JSONPath "${path}" needs an array where another metric's path put ${describe(cur)}`;
                let at: number;
                if (s.kind == "index") {
                    while (cur.length <= s.index) cur.push({});
                    at = s.index;
                }
                else {
                    at = cur.findIndex((e: any) =>
                        is_plain(e) && e[s.field] === s.value);
                    if (at < 0) {
                        cur.push({ [s.field]: s.value });
                        at = cur.length - 1;
                    }
                }
                holder = cur; key = at;
            }
        }
        if (holder[key] !== undefined
            && !(is_plain(holder[key]) && Object.keys(holder[key]).length == 0))
            return `JSONPath "${path}" ends where another metric's path put ${describe(holder[key])}`;
        const id = this.slots.length;
        holder[key] = new Slot(id);
        this.slots.push({ holder, key });
        return id;
    }

    render (values: any[], types: string[]): string {
        this.slots.forEach((s, i) => {
            s.holder[s.key] = types[i] == "DateTime"
                ? new Date(values[i]).toISOString() : values[i];
        });
        const out = JSON.stringify(this.top.root ?? null);
        this.slots.forEach((s, i) => s.holder[s.key] = new Slot(i));
        return out;
    }
}

function describe (v: any): string {
    if (v instanceof Slot) return "a value";
    if (Array.isArray(v)) return "an array";
    return typeof v;
}

/* ---------------------------------------------------------------- */
/* XML                                                               */

type XPred =
    | { kind: "attr", name: string, value: string }
    | { kind: "child", name: string, value: string, contains: boolean }
    | { kind: "position", n: number };

interface XStep {
    axis: "child" | "descendant",
    test: string,
    preds: XPred[],
}

/* Split on / outside brackets and quotes. */
function split_xpath (path: string): { axis: "child" | "descendant", text: string }[] | string {
    const out: { axis: "child" | "descendant", text: string }[] = [];
    let i = 0;
    let axis: "child" | "descendant" = "child";
    if (path.startsWith("//")) { axis = "descendant"; i = 2; }
    else if (path.startsWith("/")) i = 1;
    else return `XPath "${path}" is relative; the generator needs one starting with /`;

    let depth = 0, quote = "", start = i;
    for (; i <= path.length; i++) {
        const c = path[i];
        if (quote) { if (c == quote) quote = ""; continue; }
        if (c == "'" || c == '"') quote = c;
        else if (c == "[") depth++;
        else if (c == "]") depth--;
        else if ((c == "/" || i == path.length) && depth == 0) {
            out.push({ axis, text: path.slice(start, i) });
            if (path[i + 1] == "/") { axis = "descendant"; i++; }
            else axis = "child";
            start = i + 1;
        }
    }
    return out;
}

const LIT = `(?:'([^']*)'|"([^"]*)")`;

function parse_pred (p: string): XPred | undefined {
    let m;
    p = p.trim();
    if ((m = new RegExp(`^@([\\w:.-]+)\\s*=\\s*${LIT}$`).exec(p)))
        return { kind: "attr", name: m[1], value: m[2] ?? m[3] };
    if ((m = new RegExp(`^contains\\(\\s*@([\\w:.-]+)\\s*,\\s*${LIT}\\s*\\)$`).exec(p)))
        return { kind: "attr", name: m[1], value: m[2] ?? m[3] };
    if ((m = new RegExp(`^([\\w:.-]+)\\s*=\\s*${LIT}$`).exec(p)))
        return { kind: "child", name: m[1], value: m[2] ?? m[3], contains: false };
    if ((m = new RegExp(`^([\\w:.-]+)\\[\\s*text\\(\\)\\s*=\\s*${LIT}\\s*\\]$`).exec(p)))
        return { kind: "child", name: m[1], value: m[2] ?? m[3], contains: false };
    if ((m = new RegExp(`^([\\w:.-]+)\\[\\s*contains\\(\\s*(?:text\\(\\)|\\.)\\s*,\\s*${LIT}\\s*\\)\\s*\\]$`).exec(p)))
        return { kind: "child", name: m[1], value: m[2] ?? m[3], contains: true };
    if ((m = /^(\d+)$/.exec(p)))
        return { kind: "position", n: parseInt(m[1]) };
    return undefined;
}

function parse_step (axis: "child" | "descendant", text: string): XStep | string {
    const m = /^(@?[\w:.-]+(?:\(\))?|\*)/.exec(text);
    if (!m) return `step "${text}"`;
    const preds: XPred[] = [];
    let rest = text.slice(m[0].length);
    while (rest.length) {
        if (rest[0] != "[") return `step "${text}"`;
        let depth = 0, quote = "", j = 0;
        for (; j < rest.length; j++) {
            const c = rest[j];
            if (quote) { if (c == quote) quote = ""; continue; }
            if (c == "'" || c == '"') quote = c;
            else if (c == "[") depth++;
            else if (c == "]" && --depth == 0) break;
        }
        const pred = parse_pred(rest.slice(1, j));
        if (!pred) return `predicate [${rest.slice(1, j)}]`;
        preds.push(pred);
        rest = rest.slice(j + 1);
    }
    return { axis, test: m[0], preds };
}

interface XNode {
    name: string,
    attrs: Map<string, string | Slot>,
    children: XNode[],
    text?: string | Slot,
}

function new_node (name: string): XNode {
    return { name, attrs: new Map(), children: [] };
}

function descendants (n: XNode): XNode[] {
    return n.children.flatMap(c => [c, ...descendants(c)]);
}

function matches (n: XNode, s: XStep): boolean {
    if (s.test != "*" && n.name != s.test) return false;
    return s.preds.every(p => {
        if (p.kind == "attr") return n.attrs.get(p.name) === p.value;
        if (p.kind == "child")
            return n.children.some(c => c.name == p.name && c.text === p.value);
        return true;
    });
}

/* A name for an element the XPath only selects with *: componentId
 * gives Component, dataItemId gives DataItem. */
function name_for (s: XStep): string {
    const attr = s.preds.find(p => p.kind == "attr") as any;
    if (attr) {
        const base = attr.name.replace(/Id$|_id$/i, "") || "Item";
        return base[0].toUpperCase() + base.slice(1);
    }
    return "Item";
}

function esc (s: string, attr = false): string {
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return attr ? s.replace(/"/g, "&quot;") : s;
}

export class XmlDoc implements PayloadDoc {
    content_type = "application/xml";
    private root?: XNode;
    private slots: { node: XNode, attr?: string }[] = [];

    /* Every absolute path must agree on the root element, so look at
     * them all before placing any. */
    set_root (paths: string[]) {
        const names = new Set<string>();
        for (const p of paths) {
            const parts = split_xpath(p);
            if (typeof parts == "string" || !parts.length) continue;
            if (parts[0].axis == "child") {
                const step = parse_step("child", parts[0].text);
                if (typeof step != "string" && step.test != "*")
                    names.add(step.test);
            }
        }
        this.root = new_node(names.size ? [...names][0] : "Document");
    }

    place (path: string): number | string {
        if (!path) return "XML metric has no XPath";
        if (!this.root) this.set_root([path]);
        const root = this.root!;
        const parts = split_xpath(path);
        if (typeof parts == "string") return parts;

        const steps: XStep[] = [];
        for (const p of parts) {
            const s = parse_step(p.axis, p.text);
            if (typeof s == "string")
                return `XPath "${path}": the generator cannot invert ${s}`;
            steps.push(s);
        }

        /* The last step may pick out text, a node or an attribute. */
        let terminal: "text" | "attr" | "element" = "element";
        let attr = "";
        const last = steps[steps.length - 1];
        if (last.test == "text()" || last.test == "node()") {
            terminal = "text"; steps.pop();
        }
        else if (last.test.startsWith("@")) {
            terminal = "attr"; attr = last.test.slice(1); steps.pop();
        }

        /* The document node has the root as its only child. */
        const doc: XNode = { name: "#document", attrs: new Map(), children: [root] };
        let ctx = doc;
        for (const s of steps) {
            if (/\(\)$/.test(s.test) || s.test.startsWith("@"))
                return `XPath "${path}": the generator cannot invert step ${s.test} in the middle`;
            const pos = s.preds.find(p => p.kind == "position") as any;
            const pool = s.axis == "child" ? ctx.children : descendants(ctx);
            const found = pool.filter(n => matches(n, s));
            const want = pos ? pos.n : 1;
            if (found.length >= want) { ctx = found[want - 1]; continue; }
            if (ctx === doc) {
                if (s.axis == "child")
                    return `XPath "${path}" needs root element <${s.test}> but the document root is <${root.name}>`;
                ctx = root;
            }
            let made: XNode | undefined;
            for (let k = found.length; k < want; k++) {
                made = new_node(s.test == "*" ? name_for(s) : s.test);
                for (const p of s.preds) {
                    if (p.kind == "attr") made.attrs.set(p.name, p.value);
                    else if (p.kind == "child") {
                        const c = new_node(p.name);
                        c.text = p.value;
                        made.children.push(c);
                    }
                }
                ctx.children.push(made);
            }
            ctx = made!;
        }
        if (ctx === doc) return `XPath "${path}" selects the document`;

        const id = this.slots.length;
        if (terminal == "attr") {
            if (ctx.attrs.has(attr))
                return `XPath "${path}" ends on attribute @${attr}, which another metric's path already uses`;
            ctx.attrs.set(attr, new Slot(id));
            this.slots.push({ node: ctx, attr });
        }
        else {
            if (ctx.text !== undefined)
                return `XPath "${path}" ends on text another metric's path already uses`;
            ctx.text = new Slot(id);
            this.slots.push({ node: ctx });
        }
        return id;
    }

    render (values: any[], types: string[]): string {
        const val = (s: string | Slot | undefined) => s instanceof Slot
            ? as_text(values[s.id], types[s.id]) : s;
        const out = (n: XNode, ind: string): string => {
            const attrs = [...n.attrs].map(([k, v]) =>
                ` ${k}="${esc(val(v) ?? "", true)}"`).join("");
            const text = n.text === undefined ? "" : esc(val(n.text) ?? "");
            if (!n.children.length)
                return `${ind}<${n.name}${attrs}>${text}</${n.name}>\n`;
            return `${ind}<${n.name}${attrs}>${text}\n`
                + n.children.map(c => out(c, ind + "  ")).join("")
                + `${ind}</${n.name}>\n`;
        };
        return `<?xml version="1.0" encoding="UTF-8"?>\n`
            + (this.root ? out(this.root, "") : "");
    }
}

/* ---------------------------------------------------------------- */
/* Delimited string                                                  */

export class DelimitedDoc implements PayloadDoc {
    content_type = "text/plain";
    private fields: (number | undefined)[] = [];
    private whole?: number;
    private n = 0;

    constructor (private delimiter: string) {}

    place (path: string): number | string {
        if (path == null || path == "") {
            if (this.whole !== undefined || this.fields.length)
                return "two metrics read the whole payload of one address";
            return this.whole = this.n++;
        }
        if (this.delimiter == "")
            return `the connection has no delimiter, so the agent indexes `
                + `path "${path}" into the payload text as a string and gets `
                + `undefined or a single character`;
        if (!/^\d+$/.test(path))
            return `path "${path}" is not a field index`;
        if (this.whole !== undefined)
            return "another metric reads the whole payload of this address";
        const i = parseInt(path);
        if (this.fields[i] !== undefined)
            return `field ${i} is already used`;
        this.fields[i] = this.n++;
        return this.fields[i]!;
    }

    render (values: any[], types: string[]): string {
        if (this.whole !== undefined)
            return as_text(values[this.whole], types[this.whole]);
        return Array.from(this.fields, (s, i) => s === undefined
            ? `f${i}` : as_text(values[s], types[s])).join(this.delimiter);
    }
}

/* ---------------------------------------------------------------- */
/* Buffer                                                            */

/* Bytes taken by each fixed-size type the Buffer format reads. 64-bit
 * integers are left out: the agent reads them as BigInt, which the
 * generator's numbers can't be compared with. */
const BUFFER_SIZES: { [type: string]: number } = {
    Int8: 1, UInt8: 1, Int16: 2, UInt16: 2, Int32: 4, UInt32: 4,
    Float: 4, Double: 8,
};

interface BufferField {
    slot: number,
    offset: number,
    /* Boolean only: the bit in the byte at offset. */
    bit?: number,
    size: number,
    type: string,
    big_endian: boolean,
}

/* A binary payload read with the Buffer format. A path is a byte
 * offset; a Boolean is `offset:bit`; a String runs from its offset to
 * the end of the payload, so it must come after every other field.
 * Endianness comes from the metric's type (FloatBE, Int16LE), little
 * by default, as the agent reads it. Rendered as base64. */
export class BufferDoc implements PayloadDoc {
    content_type = "application/octet-stream";
    binary = true;
    private fields: BufferField[] = [];
    private string?: BufferField;
    private n = 0;

    place (path: string, m?: ReadMetric): number | string {
        if (!m) return "the Buffer format needs the metric's type";
        const parts = /^(\d+)(?::(\d+))?$/.exec(path ?? "");
        if (!parts) return `path "${path}" is not a byte offset`;
        const offset = parseInt(parts[1]);
        const second = parts[2] === undefined ? undefined : parseInt(parts[2]);
        const big_endian = Number(m.metric.properties?.endianness?.value) == 4321;

        let f: BufferField;
        if (m.type == "Boolean") {
            if (second === undefined || second > 7)
                return `a Boolean in a Buffer needs a bit, as "offset:bit"`;
            f = { slot: -1, offset, bit: second, size: 1, type: m.type, big_endian };
        }
        else if (m.type == "String") {
            if (second !== undefined)
                return "a String with an end offset is not synthesised";
            if (this.string) return "two Strings both run to the end of the payload";
            f = { slot: -1, offset, size: 0, type: m.type, big_endian };
        }
        else {
            const size = BUFFER_SIZES[m.type];
            if (!size) return `type ${m.type} is not synthesised in a Buffer`;
            if (second !== undefined)
                return `path "${path}" has a bit, which only a Boolean reads`;
            f = { slot: -1, offset, size, type: m.type, big_endian };
        }

        const clash = this.fields.find(g => g.offset < f.offset + Math.max(f.size, 1)
            && f.offset < g.offset + g.size
            && !(f.bit !== undefined && g.bit !== undefined && f.bit != g.bit));
        if (clash) return `bytes at offset ${f.offset} overlap another metric`;
        const end = Math.max(f.offset + f.size, ...this.fields.map(g => g.offset + g.size));
        const s = f.type == "String" ? f : this.string;
        if (s && end > s.offset)
            return `the String at offset ${s.offset} runs to the end, `
                + "so nothing can come after it";

        f.slot = this.n++;
        if (f.type == "String") this.string = f;
        else this.fields.push(f);
        return f.slot;
    }

    render (values: any[], _types: string[]): string {
        const fixed = Math.max(0, ...this.fields.map(f => f.offset + f.size));
        const text = this.string
            ? Buffer.from(String(values[this.string.slot]), "utf8") : undefined;
        const buf = Buffer.alloc(this.string
            ? Math.max(fixed, this.string.offset) + text!.length : fixed);
        if (text) text.copy(buf, this.string!.offset);
        for (const f of this.fields) {
            const v = values[f.slot];
            const e = f.big_endian ? "BE" : "LE";
            switch (f.type) {
                case "Boolean":
                    if (v) buf[f.offset] |= 1 << f.bit!;
                    break;
                case "Int8": buf.writeInt8(v, f.offset); break;
                case "UInt8": buf.writeUInt8(v, f.offset); break;
                default:
                    (buf as any)[`write${f.type}${e}`](v, f.offset);
            }
        }
        return buf.toString("base64");
    }
}
