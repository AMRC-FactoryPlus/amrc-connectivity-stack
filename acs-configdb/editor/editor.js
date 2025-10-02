/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * GUI editor frontend
 * Copyright 2022 AMRC
 */

/* Tell ESLint this is DOM code. */
/* global document */

import { h, render, createContext } 
                    from "https://esm.sh/preact@10.19.2";
import { useContext, useEffect, useId, useRef, useState }
                    from "https://esm.sh/preact@10.19.2/hooks";
import { signal }   from "https://esm.sh/@preact/signals@1.2.2";
import htm          from "https://esm.sh/htm@3.1.1";
import yaml         from "https://esm.sh/yaml@2.3.4";

const html = htm.bind(h);

const AppUuid = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    General_Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
};

let Token = null;

async function service_fetch(path, opts) {
    const get_tok = async () => {
        const res = await fetch("/token", {method: "POST"});
        if (!res.ok) return;

        const json = await res.json();
        Token = json.token;
        console.log(`Got service token ${Token}`);
    };

    const _try = async (url, opts) => {
        if (Token == null) await get_tok();
        if (Token == null) return;

        opts = {...opts, cache: "reload"};
        opts.headers = {...opts.headers};
        opts.headers["Authorization"] = `Bearer ${Token}`;
        return await fetch(url, opts);
    };

    let res = await _try(path, opts);
    if (res?.status == 401) {
        Token = null;
        res = await _try(path, opts);
    }

    return res;
}

async function fetch_json(path) {
    const rsp = await service_fetch(`/v2/${path}`);
    if (rsp.status != 200) return;

    const json = await rsp.json();
    if (Array.isArray(json))
        json.sort();

    return json;
}

async function get_info (uuid, with_class) {
    const [reg, info] = await Promise.all(
        [AppUuid.Registration, AppUuid.General_Info]
        .map(app => fetch_json(`app/${app}/object/${uuid}`)));

    const rv = { uuid, reg, info };
    if (with_class && reg?.class)
        rv.klass = await get_info(reg.class, false);

    return rv;
}

function st_ok (st) { return st >= 200 && st < 300; }

async function put_string(path, conf, method, type) {
    method ??= "PUT";
    type ??= "application/json";
    const rsp = await service_fetch(`/v1/${path}`, {
        method,
        headers: {
            "Content-Type": type,
        },
        body: conf,
    });

    return rsp.status;
}

function put_json(path, json, method, type) {
    return put_string(path, JSON.stringify(json), method, type);
}

function patch_json (path, patch) {
    return put_json(path, patch, "PATCH", "application/merge-patch+json");
}

async function post_json(path, json) {
    const rsp = await service_fetch(`/${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(json),
    });

    if (rsp.status > 299)
        return null;
    if (rsp.status == 204)
        return true;

    return await rsp.json();
}

async function delete_path(path) {
    const rsp = await service_fetch(`/v1/${path}`, {
        method: "DELETE",
    });
    return rsp.status == 204;
}

const ObjInfo = createContext(true);
const Ranks = createContext(null);

function build_opener() {
    const [open, set_open] = useState(false);

    const open_close = () => set_open(!open);
    const button = html`
        <button onClick=${open_close}>${open ? "v" : ">"}</button>
    `;

    return [open, button];
}

function Opener(props) {
    const { obj, extra, children } = props;
    const [open, button] = build_opener();

    const title = props.title ?? html`<${ObjTitle} obj=${obj}/>`;

    return html`
        <dt>${button} ${extra} ${title}</dt>
        <dd>${open ? children : ""}</dd>
    `;
}

function Uuid(props) {
    const uuid = props.children;
    const ref = useRef(null);
    const copy = () => {
        navigator.clipboard.writeText("" + uuid);

        const el = ref.current;
        if (ref) {
            el.style.color = "red";
            setTimeout(() => el.style.color = null, 500);
        }
    };

    return html`<tt ref=${ref} onClick=${copy}>${uuid}</tt>`;
}

function ObjName (props) {
    const { obj, with_class } = props;

    const format = ({ info, reg }) => {
        const name = info ? info.name : html`<i>NO NAME</i>`;
        return reg?.deleted ? html`<s>${name}</s>` : name;
    };

    const oname = format(obj);
    if (!with_class) return oname;

    const kname = 
        obj.reg ?
            obj.klass ? format(obj.klass) : html`<i>No class</i>`
        : html`<i>UNREGISTERED</i>`;
    return html`${oname} <small>(${kname})</small>`;
}

function ObjTitleCtx(props) {
    const { with_class } = props;
    const obj = useContext(ObjInfo);

    const name = obj.reg
        ? html`<${ObjName} obj=${obj} with_class=${with_class}/>`
        : html`<b>...</b>`;

    return html`<${Uuid}>${obj.uuid}<//> ${name}`;
}

function ObjTitle (props) {
    const { obj } = props;

    return html`
        <${ObjFetchInfo} obj=${obj}>
            <${ObjTitleCtx}/>
        <//>
    `;
}

function ObjMenu (props) {
    const { menu } = props;
    const info = useContext(ObjInfo);
    const ranks = useContext(Ranks);

    if (!info || !ranks) return;

    const obj = info.uuid;
    const name = info.info?.name ?? obj;
    const rank = info.reg?.rank;

    const reg = `app/${AppUuid.Registration}/object`;
    const items = [
        name,
        ["Delete object", "DELETE", `object/${obj}`],
        ["Raise rank", "PATCH", `${reg}/${obj}`, 
            { rank: rank + 1, class: ranks[rank + 1] }],
        ["Lower rank", "PATCH", `${reg}/${obj}`, 
            { rank: rank - 1, class: ranks[rank - 1] }],
        null,
        ...menu,
    ];

    return html`<${MenuButton} items=${items}/>`;
}

function MenuButton (props) {
    const { items } = props;
    const id = useId();

    const buttons = items.map(item => {
        if (item == null) return html`<hr/>`;
        if (typeof item == "string") return html`<b>${item}<//>`;

        const [title, method, path, body] = item;
        const action = () => service_fetch(`/v2/${path}`, {
            method,
            headers:    { 
                "Content-Type": method == "PATCH"
                    ? "application/merge-patch+json"
                    : "application/json",
            },
            body:       body ? JSON.stringify(body) : undefined,
        });
        return html`<button onClick=${action}>${title}<//>`
    }).map(i => html`<li>${i}<//>`);

    return html`
        <span className="menu-anchor">
            <button className="menu-button" popovertarget="${id}">...<//>
            <menu id="${id}" className="menu-popup" popover="auto">
                ${buttons}
            <//>
        <//>
    `;
}

function Editor(props) {
    return html`
        <h1>ACS | Config Store</h1>
        <p>The display does not always update when you change things.
            You might need to reopen sections or refresh the page.</p>
       <${SetUseYAML}/> 
        <dl>
            <${Opener} title="Applications">
                <${Apps}/>
            <//>
            <${Opener} title="Objects">
                <${Objs}/>
            <//>
            <${Opener} title="JSON dumps">
                <${Dumps}/>
            <//>
        </dl>
    `
}

const Formats = {
    json: {
        read:   JSON.parse,
        write:  d => JSON.stringify(d, null, 4),
    },
    yaml: {
        read:   yaml.parse,
        write:  d => yaml.stringify(d, null, {
            sortMapEntries:     true,
            blockQuote:         "literal",
            indent:             2,
        }),
    },
};
const Formatter = createContext(signal(Formats.yaml));

function SetUseYAML (props) {
    const format = useContext(Formatter);

    const option = (frm, label) => html`
        <label>
            <input type="radio" 
                checked=${format.value == frm} 
                onClick=${() => format.value = frm}/>
            ${label}
        </label>
    `;

    return html`
        <span>
            ${option(Formats.yaml, "YAML")}
            ${option(Formats.json, "JSON")}
        </span>
    `;
}

function Apps(props) {
    const [apps, set_apps] = useState([]);
    const [msg, set_msg] = useState("");

    const update_apps = async () => set_apps(await fetch_json("app"));

    useEffect(update_apps, []);

    const new_uuid = useRef(null);
    const new_name = useRef(null);
    const add_app = async () => {
        if (!new_uuid.current || !new_name.current) return;
        const body = {
            uuid: new_uuid.current.value,
            name: new_name.current.value,
        };
        if (await post_json(`v1/app`, body)) {
            set_msg("App created");
        } else {
            set_msg("Error");
        }
        await update_apps();
    };

    return html`
        <p>
            <label>UUID <input type="text" size=40 ref=${new_uuid}/></label><br/>
            <label>Name <input type="text" size=40 ref=${new_name}/></label><br/>
            <button onClick=${add_app}>Add app</button>
            ${msg}
        </p>
        <dl>
            ${apps.map(a => html`
                <${Opener} obj=${a} key=${a}>
                    <${App} app=${a}/></
                    />`)}
        </dl>
    `;
}

function Objs(props) {
    const [ranks, set_ranks] = useState(null);

    useEffect(() => {
        service_fetch("/v2/object/rank")
            .then(r => r.status == 200 ? r.json() : null)
            .then(set_ranks);
    }, []);

    if (!ranks)
        return html`<b>...</b>`;

    //const hranks = ranks.map((r, d) => html`
    //    <${Opener} obj=${r} key=${r}><${Rank} rank=${r} depth=${d}/><//>
    //`);
    const hranks = ranks.map(r => html`<${Obj} obj=${r}/>`);
  
    return html`
        <${Ranks.Provider} value=${ranks}>
            <${NewObj}/>
            <h2>Ranks of object</h2>
            <p><b>⊃</b> indicates a subclass, <b>∋</b> indicates a class member.<//>
            <dl>${hranks}</dl>
        <//>
    `;
}

function Klass(props) {
    const {klass} = props;
    const info = useContext(ObjInfo);

    const [subs, set_subs] = useState(null);
    const [objs, set_objs] = useState(null);
    const [status, set_status] = useState(null);

    const update = () => {
        fetch_json(`class/${klass}/direct/member`).then(set_objs);
        fetch_json(`class/${klass}/direct/subclass`).then(set_subs);
    };
    useEffect(update, [klass]);

    const new_s = useRef(null);
    const new_m = useRef(null);
    const add_rel = (rel, ref) => async () => {
        const obj = ref?.current?.value;
        if (!obj) return;
        const rsp = await service_fetch(
            `/v2/class/${klass}/direct/${rel}/${obj}`,
            { method: "PUT" });
        if (rsp.status == 204)
            set_status(`Added ${obj} as ${rel}`);
        else
            set_status(`Adding ${rel} failed: ${rsp.status}`);
    };

    const reg = `app/${AppUuid.Registration}/object`;
    const name = info?.info?.name ?? klass;
    const s_menu = s => [
        `Subclass of ${name}`,
        ["Remove as subclass", "DELETE", `class/${klass}/direct/subclass/${s}`],
    ];
    const m_menu = m => [
        `Member of ${name}`,
        ["Remove as member", "DELETE", `class/${klass}/direct/member/${m}`],
        ["Set primary class", "PATCH", `${reg}/${m}`, { "class": klass }],
    ];

    const notyet = html`<dt><b>...</b><//>`;
    const hsubs = subs?.map(s => 
        html`<${Obj} obj=${s} key=${s} menu=${s_menu(s)} pfx="⊃"/>`);
    const hobjs = objs?.map(o =>
        html`<${Obj} obj=${o} key=${o} menu=${m_menu(o)} pfx="∋"/>`);
    const hstat = status && html`
        <dt><p onClick=${() => set_status()}>${status}<//><//>`;

        //<h3>Subclasses ${""}
        //<h3>Members ${""}
    return html`
        <dl>
            ${hstat}
            <dt>
                <b>⊃</b> <input type=text size=40 ref=${new_s}/>
                <button onClick=${add_rel("subclass", new_s)}>Add subclass<//>
            <//><dt>
                <b>∋</b> <input type=text size=40 ref=${new_m}/>
                <button onClick=${add_rel("member", new_m)}>Add member<//>
            <//>
            ${hsubs ?? notyet}
            ${hobjs ?? notyet}
        </dl>
    `;
}

function ObjFetchInfo (props) {
    const { obj, children } = props;
    const [info, set_info] = useState({ uuid: obj });

    useEffect(() => get_info(obj, true).then(set_info), [obj]);

    return html`<${ObjInfo.Provider} value=${info}>${children}<//>`;
}

function ObjDisplay (props) {
    const { menu, pfx } = props;
    const info = useContext(ObjInfo);

    const obj = info.uuid;

    const mbutt = menu ? html`<${ObjMenu} menu=${menu}/>` : "";
    const title = html`
        ${mbutt} <b>${pfx}</b>
        <${ObjTitleCtx} with_class=${true}/>`;

    if (info?.reg?.rank == 0)
        return html`<dt>${title}<//>`;

    return html`
        <${Opener} key=${obj} title=${title}>
            <${Klass} klass=${obj}/>
        <//>
    `;
}

function Obj (props) {
    const {obj, menu, pfx} = props;
    return html`
        <${ObjFetchInfo} obj=${obj}>
            <${ObjDisplay} menu=${menu} pfx=${pfx}/>
        <//>`;
}

function NewObj(props) {
    const [msg, set_msg] = useState("");
    const new_obj = useRef();
    const new_class = useRef();
    const new_name = useRef();

    const create = async () => {
        if (!new_obj.current || !new_class.current) return;
        const spec = {
            uuid: new_obj.current.value || undefined,
            "class": new_class.current.value,
        };
        const rsp = await post_json("v2/object", spec);

        if (rsp) {
            set_msg(html`Created
            <${Uuid}>${rsp.uuid}<//>`);

            const name = new_name.current?.value;
            if (name) {
                await patch_json(
                    `app/${AppUuid.General_Info}/object/${rsp.uuid}`,
                    {name});
            }
        } else {
            set_msg("Error");
        }
    };

    return html`
        <p>
            The Class is required.<br/>
            <label>Class UUID <input type=text size=40 ref=${new_class}/></label><br/>
            To create a new object with a new UUID leave the Object blank.<br/>
            <label>Object UUID <input type=text size=40 ref=${new_obj}/></label><br/>
            If Name is supplied a General Info entry will be created for the new object.<br/>
            <label>Name <input type=text size=40 ref=${new_name}/></label><br/>
            <button onClick=${create}>Create</button>
            ${msg}
        </p>
    `;
}

function App(props) {
    const {app} = props;
    const [objs, set_objs] = useState([]);

    const update = async () => set_objs(await fetch_json(`app/${app}/object`));
    useEffect(update, []);

    return html`
        <dl>
            <${Opener} title="New config">
                <${NewConf} update=${update} app=${app}/><//>
            ${objs.map(o => html`
                <${Opener} key=${o} obj=${o}>
                    <${Conf} app=${app} obj=${o} update_parent=${update}/>
                <//>
            `)}
        </dl>
    `;
}

function Conf(props) {
    const {app, obj, update_parent} = props;

    const [conf, set_conf] = useState("...");
    const [msg, set_msg] = useState("");

    const format = useContext(Formatter).value;

    const update_conf = async () =>
        set_conf(await fetch_json(`app/${app}/object/${obj}`));

    useEffect(update_conf, []);

    const editbox = useRef(null);
    const update = async () => {
        if (!editbox.current) return;
        const new_conf = editbox.current.value;

        const json = format.read(new_conf);
        const st = await put_json(`app/${app}/object/${obj}`, json);
        if (st_ok(st)) {
            set_msg(html`Config updated`);
        } else {
            set_msg(html`Error updating config: ${st}`);
        }
        await update_conf();
    };
    const delobj = async () => {
        if (!await delete_path(`app/${app}/object/${obj}`)) {
            set_msg("Error deleting config.");
        }
        update_parent();
    };

    const json = format.write(conf);
    return html`
        <textarea ref=${editbox} cols=80 rows=25 value=${json}/><br/>
        <button onClick=${update}>Update</button>
            <button onClick=${delobj}>Delete</button>
            ${msg}
    `;
}

function NewConf(props) {
    const { app, update } = props;
    const [msg, set_msg] = useState("");

    const format = useContext(Formatter).value;

    const new_obj = useRef();
    const new_conf = useRef();

    const create = async () => {
        if (!new_obj.current || !new_conf.current) return;
        const json = format.read(new_conf.current.value);
        const st = await put_json(
            `app/${app}/object/${new_obj.current.value}`,
            json);
        if (st_ok(st)) {
            await update();
            set_msg("Create succeeded");
            new_obj.current.value = "";
            new_conf.current.value = "";
        }
        else {
            set_msg(`Create failed: ${st}`);
        }
    };

    return html`
        <label>Object UUID <input type=text size=40 ref=${new_obj}/></label><br/>
        <textarea ref=${new_conf} rows=25 cols=80/><br/>
        <button onClick=${create}>Create</button> ${msg}
    `;
}

async function save_dump() {
    const dump = await fetch_json("save");
    const pretty = JSON.stringify(dump, null, 4);
    const blob = new Blob([pretty], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const anch = document.createElement("a");

    anch.href = url;
    anch.setAttribute("download", "configdb-dump.json");
    anch.click();
    setTimeout(() => URL.revokeObjectURL(url), 200);
}

function Dumps(props) {
    const [msg, set_msg] = useState("");

    const dump_r = useRef(null);
    const file_r = useRef(null);

    const load = async () => {
        const dump = JSON.parse(dump_r.current?.value);
        if (dump == null) {
            set_msg("Error reading dump from textbox");
            return;
        }

        const ok = await post_json(`load`, dump);
        set_msg(ok ? "Loaded dump" : "Failed");
        if (ok) dump_r.current.value = "";
    };
    const read_file = async () => {
        if (dump_r.current == null) return;

        set_msg("Reading file...");
        const json = await file_r.current?.files[0]?.text();
        if (json != null)
            dump_r.current.value = json;

        set_msg("");
    };

    return html`
        <p>
            <button onClick=${save_dump}>Save JSON dump</button>
        </p>
        <p><textarea cols=80 rows=24 ref=${dump_r}></textarea></p>
        <p><input type=file ref=${file_r} onChange=${read_file}/></p>
        <p>
            <button onClick=${load}>Load JSON dump</button>
            ${msg}
        </p>
    `;
}

render(html`
    <${Editor}/>`, document.body);
