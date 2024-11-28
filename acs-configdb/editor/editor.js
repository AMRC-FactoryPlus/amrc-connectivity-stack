/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * GUI editor frontend
 * Copyright 2022 AMRC
 */

/* Tell ESLint this is DOM code. */
/* global document */

import { h, render, createContext } 
                    from "https://esm.sh/preact@10.19.2";
import { useContext, useEffect, useRef, useState }
                    from "https://esm.sh/preact@10.19.2/hooks";
import { signal }   from "https://esm.sh/@preact/signals@1.2.2";
import htm          from "https://esm.sh/htm@3.1.1";
import yaml         from "https://esm.sh/yaml@2.3.4";

const html = htm.bind(h);

const AppUuid = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    General_Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
};
const Class = {
    Rank:       "1f2ee062-6782-48c8-926b-904f56bd18b1",
    Individual: "33343846-8c14-4cb0-8027-989071a20724",
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

async function get_name (obj, with_class) {
    const [reg, inf] = await Promise.all(
        [AppUuid.Registration, AppUuid.General_Info]
        .map(app => fetch_json(`app/${app}/object/${obj}`)));

    const name = inf ? inf.name : html`<i>NO NAME</i>`;
    const dname = reg?.deleted ? html`<s>${name}</s>` : name;
    if (!with_class) return dname;

    const kname = reg
        ? reg.class
            ? await get_name(reg.class, false)
            : html`<i>No class</i>`
        : html`<i>UNREGISTERED</i>`;
    return html`${dname} <small>(${kname})</small>`;
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
    const rsp = await service_fetch(`/v1/${path}`, {
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

    const title = "obj" in props
        ? html`<${ObjTitle} obj=${obj}/>`
        : props.title;

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

function ObjTitle(props) {
    const { obj } = props;
    const [name, set_name] = useState("...");

    useEffect(async () => set_name(await get_name(obj, true)), [obj]);

    return html`
        <${Uuid}>${obj}<//> ${name}`;
}

function MenuButton (props) {
    const { menu } = props;
    const [open, set_open] = useState(false);

    if (!open)
        return html`<button onClick=${() => set_open(true)}>...<//>`;

    const buttons = menu.map(([title, action]) => html`
        <button onClick=${action}>${title}<//><br/>`);

    return html`
        <button className="menu-button">...
            <div className="menu-popup">
                ${buttons}
                <button onClick=${() => set_open(false)}>Cancel<//>
        <//><//>
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
        if (await post_json(`app`, body)) {
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

    const hranks = ranks.map(r => html`
        <${Opener} obj=${r} key=${r}><${Rank} rank=${r}/><//>
    `);
  
    return html`
        <${NewObj}/>
        <dl>
            ${hranks}
        </dl>
    `;
}

function Rank (props) {
    const { rank } = props;
    const [subs, set_subs] = useState(null);

    useEffect(() =>
        fetch_json(`class/${rank}/direct/subclass`).then(set_subs), []);

    if (!subs) return html`<b>...</b>`;

    const menu = s => [
        ["Raise rank",   () => console.log("Raise rank of %s", s)],
    ];

    return subs.map(s => html`
        <${Obj} obj=${s} key=${s} klass=${true} menu=${menu(s)}/>
    `);
}

function Klass(props) {
    const {klass} = props;
    const [subs, set_subs] = useState(null);
    const [objs, set_objs] = useState(null);

    const update = () => {
        fetch_json(`class/${klass}/direct/member`).then(set_objs);
        fetch_json(`class/${klass}/direct/subclass`).then(set_subs);
    };
    useEffect(update, [klass]);

    const s_menu = s => [
        ["Remove",   () => 
            console.log("Remove subclass %s from %s", s, klass)],
    ];
    const m_menu = m => [
        ["Remove",  () =>
            console.log("Remove member %s from %s", m, klass)],
    ];

    const notyet = html`<b>...</b><br/>`;
    const hsubs = subs?.map(s => 
        html`<${Obj} obj=${s} key=${s} klass=${true} menu=${s_menu(s)}/>`);
    const hobjs = objs?.map(o =>
        html`<${Obj} obj=${o} key=${o} menu=${m_menu(o)}/>`);

    return html`
        <b>Subclasses</b><br/>
        ${hsubs ?? notyet}
        <b>Members</b><br/>
        ${hobjs ?? notyet}
    `;
}

function Obj (props) {
    const {obj, klass, menu} = props;
    const [ind, set_ind] = useState(false);

    if (!klass)
        useEffect(() => service_fetch(
            `/v2/class/${Class.Individual}/any/member/${obj}`)
            .then(rsp => set_ind(rsp.status == 204)));

    /*const do_delete = async () => {
        const ok = await delete_path(`object/${obj}`);
        if (!ok) set_msg("Delete failed");
        await update();
    };*/

    const mbutt = menu && html`<${MenuButton} menu=${menu}/>`;

    if (ind)
        return html`${mbutt} <${ObjTitle} obj=${obj}/><br/>`;

    return html`
        <${Opener} obj=${obj} key=${obj} extra=${mbutt}>
            <${Klass} klass=${obj}/>
        <//>
    `;
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
        const rsp = await post_json("object", spec);

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
    const ovrw_r = useRef(null);

    const load = async () => {
        const dump = JSON.parse(dump_r.current?.value);
        if (dump == null) {
            set_msg("Error reading dump from textbox");
            return;
        }
        const ovrw = !!ovrw_r.current?.checked;

        const ok = await post_json(`load?overwrite=${ovrw}`, dump);
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
        <p><label><input type=checkbox ref=${ovrw_r}/> Overwrite existing entries</label></p>
        <p>
            <button onClick=${load}>Load JSON dump</button>
            ${msg}
        </p>
    `;
}

render(html`
    <${Editor}/>`, document.body);
