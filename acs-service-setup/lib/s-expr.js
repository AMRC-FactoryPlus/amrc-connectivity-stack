import { parse } from "@thi.ng/sexpr";

class BadSexpr extends Error {};

function fail (msg, val) {
    throw new BadSexpr(msg.replace("%o", val.toString()));
}

export function sx (strs) {
    if (strs.length != 1)
        fail("sx with interpolation");
    return new SxFormat().from_sx(strs[0]);
}

export class SxFormat {
    constructor (uuids) {
        this.uuids = uuids ?? new Map();
    }

    sx_to_json (sx) {
        /* fall through is important */
        switch (sx.type) {
            case "root":
                return sx.children.length > 1 
                    ? fail("multiple sx")
                    : this.sx_to_json(sx.children[0]); 
            case "sym":
                switch (sx.value) {
                    case "null": return null;
                    case "true": return true;
                    case "false": return false;
                }
                if (this.uuids.has(sx.value))
                    return this.uuids.get(sx.value);
            case "str": 
            case "num":
                return sx.value;
            case "expr": 
                switch (sx.value) {
                    case "[": 
                        return sx.children.map(i => this.sx_to_json(i)); 
                    case "{": 
                        return sx.children.reduce(
                            ([key, obj], val) => key
                                ? [null, {...obj, [key]: this.sx_to_json(val) }]
                                : [val.type == "sym" && val.value.endsWith(":")
                                    ? val.value.slice(0, -1)
                                    : fail("bad object key: %o", val), obj],
                            [null, {}])[1];
                }
            default:
                fail("unknown sx: %o", sx)
        }
    }


    from_sx (str) {
        return this.sx_to_json(parse(str, { scopes: [["[", "]"], ["{", "}"]] }));
    }

    to_sx (v) {
        const s = this._to_sx(v);
        return Array.isArray(s) ? s.join("\n") : s;
    }

    _to_sx (v) {
        if (v == null)
            return "null";
        if (typeof v == "string")
            return this._to_sx_str(v);
        if (typeof v != "object")
            return JSON.stringify(v);
        if (Array.isArray(v))
            return this._to_sx_array(v);
        return this._to_sx_obj(v);
    }

    _to_sx_str (s) {
        const sym = /^[a-zA-Z]+$/.test(s);
        return sym ? s : JSON.stringify(s);
    }

    _to_sx_array (a) {
        const items = a.map(v => _to_sx(v));
        return this._to_sx_items(items, "[", " ", "]");
    }

    _to_sx_obj (o) {
        const items = Object.entries(o).map(([k, v]) => {
            const sk = this._to_sx_str(k);
            const sv = this._to_sx(v);
            if (Array.isArray(sv))
                return [`${sk}: ${sv[0]}`, ...sv.slice(1)];
            return `${sk}: ${sv}`;
        });
        return this._to_sx_items(items, "{", ", ", "}");
    }

    _to_sx_items (items, start, sep, end) {
        if (!items.some(Array.isArray)) {
            const line = `${start}${items.join(sep)}${end}`;
            const opens = line.match(/\[/g);
            if (line.length < 80 && !(opens?.length > 4)) {
                return line;
            }
        }
        const ind = is => is.flatMap(i => Array.isArray(i) ? ind(i) : [`  ${i}`]);
        const lines = ind(items.slice(1));
        return [start + items[0], ...lines.slice(0, -1), lines.at(-1) + end];
    }
}
