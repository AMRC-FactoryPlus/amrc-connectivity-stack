/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * GUI editor frontend
 * Copyright 2022 AMRC
 */

import { h, render, createContext }                 from "preact";
import { useContext, useEffect, useRef, useState }  from "preact/hooks";
import { signal, useSignal }                        from "@preact/signals";
import htm          from "htm";
import yaml         from "yaml";

import { ServiceClient, UUIDs }     from "@amrc-factoryplus/service-client";

const html = htm.bind(h);

const AppUuid = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    General_Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
};

let Token = null;

/* XXX This should be context */
const fplus = signal(null);

/* Compat wrappers for the old hacks */
async function fetch_json (path) {
    const cdb = fplus.value.ConfigDB;
    const [st, json] = await cdb.fetch(`v1/${path}`);

    if (st != 200) return;
    if (Array.isArray(json))
        json.sort();

    return json;
}

async function put_json(path, json) {
    const cdb = fplus.value.ConfigDB;
    const [st] = await cdb.fetch({
        url:    `v1/${path}`,
        method: "PUT",
        body:   json,
    });
    return st;
}

async function post_json(path, json) {
    const [st, rsp] = await fplus.value.ConfigDB.fetch({
        url:    `v1/${path}`,
        method: "POST",
        body:   json,
    });

    if (st > 299)
        return null;
    if (st == 204)
        return true;

    return rsp;
}

async function delete_path(path) {
    const [st] = await fplus.value.ConfigDB.fetch({
        url:    `v1/${path}`,
        method: "DELETE",
    });
    return st == 204;
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
    return html`
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

function Login (props) {
    const { directory_url } = props;
    const username = useSignal("");
    const password = useSignal("");
    const message = useSignal("");

    const try_login = async () => {
        const fp = await new ServiceClient({
            directory_url, username, password,
            browser: true,
            verbose: "ALL",
        }).init();
        const rv = await fp.Directory.ping();
        if (!rv) {
            message.value = "Login failed";
            return;
        }
        fplus.value = fp;
    };

    return html`
        <p>Using Directory <tt>${directory_url}</tt><br/>
            <label>Username: <input type=text size=20 value=${username} 
                onInput=${e => username.value = e.currentTarget.value}
                /></label><br/>
            <label>Password: <input type=password size=20 value=${password} 
                onInput=${e => password.value = e.currentTarget.value}
            /></label><br/>
            <button onClick=${try_login}>Log in</button><br/>
            <b>${message}</b>
        </p>
    `;
}

function CheckLogin (props) {
    const { directory } = props;

    if (fplus.value == null)
        return html`<${Login} directory_url=${directory}/>`;
    else
        return html`<${Editor}/>`;
}

export async function run (container, directory) {
    render(html`<${CheckLogin} directory=${directory}/>`, container);
}
