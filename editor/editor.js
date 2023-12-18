/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * GUI editor frontend
 * Copyright 2022 AMRC
 */

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

let Token = null;

const Formatter = createContext(signal(yaml));

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
    const rsp = await service_fetch(`/v1/${path}`);
    if (rsp.status != 200) return;

    const json = await rsp.json();
    if (Array.isArray(json))
        json.sort();

    return json;
}

async function get_class(obj) {
    const reg = await fetch_json(`app/${AppUuid.Registration}/object/${obj}`);
    return reg ? reg["class"] : null;
}

async function _get_name (obj) {
    const gi = await fetch_json(`app/${AppUuid.General_Info}/object/${obj}`);
    return gi 
        ? gi.deleted
            ? html`<s>${gi.name}</s>`
            : gi.name
        : html`<i>NO NAME</i>`;
}

async function get_name (obj, with_class) {
    const name = await _get_name(obj);
    if (!with_class) return name;

    const kid = await get_class(obj);
    const kname = kid ? await _get_name(kid) : html`<i>NO CLASS</i>`;
    return html`${name} <small>(${kname})</small>`;
}

function st_ok (st) { return st >= 200 && st < 300; }

async function put_string(path, conf, method = "PUT") {
    const rsp = await service_fetch(`/v1/${path}`, {
        method: method,
        headers: {
            "Content-Type": "application/json",
        },
        body: conf,
    });

    return rsp.status;
}

function put_json(path, json, method = "PUT") {
    return put_string(path, JSON.stringify(json), method);
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
    const { obj, children, with_class } = props;
    const [open, button] = build_opener();

    const title = "obj" in props
        ? html`<${ObjTitle} obj=${obj} with_class=${with_class}/>`
        : props.title;

    return html`
        <dt>${button} ${title}</dt>
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
    const { obj, with_class } = props;
    const [name, set_name] = useState("...");

    useEffect(async () => set_name(await get_name(obj, with_class)), [obj]);

    return html`
        <${Uuid}>${obj}<//> ${name}`;
}

function Editor(props) {
    const UseYAML = createContext(true);

    return html`
        <h1>ACS | Config Store</h1>
        <p>The display does not always update when you change things.
            You might need to reopen sections or refresh the page.</p>
       <${SetUseYAML}/> 
        <dl>
            <${Opener} title="Applications">
                <${Apps}/>
            </
            />
            <${Opener} title="Objects">
                <${Objs}/>
            </
            />
            <${Opener} title="JSON dumps">
                <${Dumps}/>
            </
            />
        </dl>
    `
}

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
            ${option(yaml, "YAML")}
            ${option(JSON, "JSON")}
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
    const [classes, set_classes] = useState(null);

    useEffect(async () => set_classes(await fetch_json("class")), []);

    return html`
        <${NewObj}/>
        <dl>${
                classes?.map(c => html`
                    <${Opener} obj=${c} key=${c}>
                        <${Klass} klass=${c}/></
                        />`)
                ?? html`<br/><b>...</b>`
        }
        </dl>
    `;
}

function Klass(props) {
    const {klass} = props;
    const [objs, set_objs] = useState(null);

    const update = async () => set_objs(await fetch_json(`class/${klass}`));
    useEffect(update, [klass]);

    return html`${
        objs?.map(o => html`
            <${Obj} obj=${o} key=${o} update=${update}/><br/>`)
        ?? html`<b>...</b><br/>`
    }`;
}

function Obj(props) {
    const {obj, update} = props;
    const [msg, set_msg] = useState("");

    const do_delete = async () => {
        const ok = await delete_path(`object/${obj}`);
        if (!ok) set_msg("Delete failed");
        await update();
    };

    return html`
        <button onClick=${do_delete}>Delete
        </button
        >
        <${ObjTitle} obj=${obj}
        /> ${msg}
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
                await put_json(
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
                <${Opener} key=${o} obj=${o} with_class=${true}>
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

        const json = format.parse(new_conf);
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

    const json = format.stringify(conf, null, 4);
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
        const json = format.parse(new_conf.current.value);
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
