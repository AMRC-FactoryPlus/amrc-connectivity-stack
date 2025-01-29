/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * GUI editor frontend
 * Copyright 2022 AMRC
 */

/* Tell ESLint this is DOM code. */
/* global document */

import { h, render } from "https://unpkg.com/preact@latest?module";
import { useState, useEffect, useRef } from "https://unpkg.com/preact@latest/hooks/dist/hooks.module.js?module";
import htm from "https://unpkg.com/htm?module";

import * as UUID from "https://unpkg.com/uuid@8.3.2/dist/esm-browser/index.js";

const html = htm.bind(h);

const Uuid = {
    General_Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
};

let Services;
let Creds;
const Tokens = new Map();

/* Although not async, this function returns a Promise and should
 * normally be awaited. */
function get_token (service, renew) {
    if (!(Creds && service in Services))
        return;

    if (Tokens.has(service) && !renew) {
        return Tokens.get(service);
    }

    const url = new URL("/token", Services[service]);
    const thunk = async () => {
        const res = await fetch(url, { 
            method: "POST",
            headers: {
                "Authorization": Creds,
            },
        });
        if (!res.ok) return;

        const json = await res.json();
        console.log(`Got token for ${service}: ${json.token}`);
        return json.token;
    };
    const promise = thunk();
    console.log(`Waiting for token for ${service}`);
    Tokens.set(service, promise);
    return promise;
}

async function fetch_json (service, path, method="GET", body=null, cache=false) {
    if (!(service in Services)) return;
    const url = new URL(path, Services[service]);

    const _try = async (renew) => {
        const token = await get_token(service, renew);
        const opts = {
            method, 
            headers: { "Authorization": `Bearer ${token}` },
            cache: cache ? "default" : "no-cache",
        };
        if (body != null) {
            opts.body = JSON.stringify(body);
            opts.headers["Content-Type"] = "application/json";
        }

        return await fetch(url, opts);
    };

    let rsp = await _try(false);
    if (rsp?.status == 401)
        rsp = await _try(true);

    if (!rsp) return;
    if (rsp.status > 299) return;
    if (rsp.status == 204) return true;

    const json = await rsp.json();
    if (Array.isArray(json))
        json.sort();

    return json;
}

async function _get_name (obj) {
    const gi = await fetch_json("configdb", 
        `v1/app/${Uuid.General_Info}/object/${obj}`,
        "GET", null, true);
    return gi 
        ? gi.deleted
            ? html`<s>${gi.name}</s>`
            : gi.name
        : html`<i>NO NAME</i>`;
}

async function get_name (obj) {
    const reg = await fetch_json("configdb", 
        `v1/app/${Uuid.Registration}/object/${obj}`,
        "GET", null, true);
    const name = await _get_name(obj);
    const klass = reg ? await _get_name(reg.class) : html`<i>NO CLASS</i>`;
    return html`${name} <small>(${klass})</small>`;
}

function sort_acl (list) {
    list.sort((a, b) =>
        a.principal > b.principal ? 1
        : a.principal < b.principal ? -1
        : a.permission > b.permission ? 1
        : a.permission < b.permission ? -1
        : a.target > b.target ? 1
        : a.target < b.target ? -1
        : 0);
}

function build_opener () {
    const [open, set_open] = useState(false);

    const open_close = () => set_open(!open);
    const button = html`
        <button onClick=${open_close}>${ open ? "v" : ">" }</button>
    `;

    return [open, button];
}

function Opener (props) {
    const [open, button] = build_opener();

    const title = "obj" in props
        ? html`<${ObjTitle} obj=${props.obj}/>`
        : props.title;

    return html`
        <dt>${button} ${title}</dt>
        <dd>${ open ? props.children : "" }</dd>
    `;
}

function Clip (props) {
    const content = props.children;
    const ref = useRef(null);
    const copy = () => {
        navigator.clipboard.writeText("" + content);

        const el = ref.current;
        if (ref) {
            el.style.color = "red";
            setTimeout(() => el.style.color = null, 500);
        }
    };

    return html`<tt ref=${ref} onClick=${copy}>${content}</tt>`;
}

function ObjTitle (props) {
    const obj = props.obj;
    const [name, set_name] = useState("...");

    useEffect(async () => set_name(await get_name(obj)), [obj]);

    return html`<${Clip}>${obj}<//> ${name}`;
}

function Editor (props) {

    return html`
        <h1>Factory+ authentication editor</h1>
        <p>The display does not always update when you change things. 
            You might need to reopen sections or refresh the page.</p>
        <dl>
            <${Opener} title="ACL entries"><${ACEs}/><//>
            <${Opener} title="Kerberos principals"><${Principals}/><//>
            <${Opener} title="Groups"><${Groups}/><//>
            <${Opener} title="Effective permissions"><${Effective}/><//>
            <${Opener} title="Load JSON dump"><${LoadDump}/><//>
        </dl>
    `
}

function ACEs (props) {
    const [aces, set_aces] = useState([]);
    const [msg, set_msg] = useState("");

    const update_aces = async () => {
        const list = await fetch_json("auth", "/authz/ace");
        sort_acl(list);
        set_aces(list);
    };

    useEffect(update_aces, []);

    const new_princ = useRef(null);
    const new_perm = useRef(null);
    const new_targ = useRef(null);

    const add_ace = async () => {
        const ace = {
            principal: new_princ.current?.value,
            permission: new_perm.current?.value,
            target: new_targ.current?.value,
        };
        for (const k in ace) {
            if (!UUID.validate(ace[k])) {
                set_msg("Bad UUID");
                return;
            }
        }

        ace.action = "add";
        const ok = await fetch_json("auth", "/authz/ace", "POST", ace);
        set_msg(ok ? "Created ACE" : "Failed");
        await update_aces();
    };
    const del_ace = async (ace) => {
        const action = {
            ...ace,
            action: "delete",
        };
        const ok = await fetch_json("auth", "/authz/ace", "POST", action);
        set_msg(ok ? "Deleted ACE" : "Failed");
        await update_aces();
    };

    return html`
        <table>
            <tr><th>Principal</th><th>Permission</th><th>Target</th><th>Plural</th></tr>
            ${ aces.map(a => html`
            <tr key=${`${a.principal}/${a.permission}/${a.target}`}>
                <td><${Obj} obj=${a.principal}/></td>
                <td><${Obj} obj=${a.permission}/></td>
                <td><${Obj} obj=${a.target}/></td>
                <td>${ a.plural ? "🗸" : "🗴" }</td>
                <td><button onClick=${() => del_ace(a)}>Delete ACE</button></td>
            </tr>
            `) }
            <tr>
                <td><input type="text" size=40 ref=${new_princ}/></td>
                <td><input type="text" size=40 ref=${new_perm}/></td>
                <td><input type="text" size=40 ref=${new_targ}/></td>
                <td><button onClick=${add_ace}>Add ACE</button></td>
            </tr>
        </table>
        <p>${msg}</p>
    `;
}

function Principals (props) {
    const [princs, set_princs] = useState([]);
    const [msg, set_msg] = useState("");

    const update_princs = async () => {
        const list = await fetch_json("auth", "/authz/principal");
        list.sort((a, b) => a.uuid > b.uuid ? 1 : -1);
        set_princs(list);
    };

    useEffect(update_princs, []);

    const new_uuid = useRef(null);
    const new_kerb = useRef(null);

    const add_princ = async () => {
        const princ = {
            uuid: new_uuid.current?.value,
            kerberos: new_kerb.current?.value,
        };
        if (!UUID.validate(princ.uuid)) {
            set_msg("Bad UUID");
            return;
        }

        const ok = await fetch_json("auth", "/authz/principal", "POST", princ);
        set_msg(ok ? "Created principal" : "Failed");
        await update_princs();
    };
    const del_princ = async (princ) => {
        const ok = await fetch_json("auth", 
            `/authz/principal/${princ.uuid}`, "DELETE");
        set_msg(ok ? "Deleted principal" : "Failed");
        await update_princs();
    };

    return html`
        <table>
            <tr><th>UUID</th><th>Kerberos principal</th></tr>
            ${ princs.map(p => html`
            <tr>
                <td><${Obj} obj=${p.uuid}/></td>
                <td><${Clip}>${p.kerberos}<//></td>
                <td><button onClick=${() => del_princ(p)}>Delete</button></td>
            </tr>
            `) }
            <tr>
                <td><input type="text" size=40 ref=${new_uuid}/></td>
                <td><input type="text" size=40 ref=${new_kerb}/></td>
                <td><button onClick=${add_princ}>Add principal</button></td>
            </tr>
        </table>
        <p>${msg}</p>
    `;
}

function Groups (props) {
    const [msg, set_msg] = useState("");
    const [groups, set_groups] = useState(null);

    const update_grps = async () => set_groups(await fetch_json("auth", "/authz/group"));
    useEffect(update_grps, []);

    const new_grp = useRef(null);
    const new_mem = useRef(null);

    const add_grp = async () => {
        const grp = new_grp.current?.value;
        const mem = new_mem.current?.value;
        if (!UUID.validate(grp) || !UUID.validate(mem)) {
            set_msg("Bad UUID");
            return;
        }
        const ok = await fetch_json("auth",
            `/authz/group/${grp}/${mem}`, "PUT");
        set_msg(ok ? "Created group" : "Failed");
        update_grps();
    };

    const grp_html = groups ? html`
        <dl>
        ${ groups.map(g => html`
            <${Opener} obj=${g} key=${g}><${Group} group=${g}/><//>`) }
        </dl>
    ` : html`<p><b>...</b></p>`;
    return html`
        ${grp_html}
        <p>
            <label>Group <input type="text" size=40 ref=${new_grp}/></label><br/>
            <label>Member <input type="text" size=40 ref=${new_mem}/></label><br/>
            <button onClick=${add_grp}>Add group</button> ${msg}
        </p>
    `;
}

function Group (props) {
    const {group} = props;
    const [msg, set_msg] = useState("");
    const [members, set_members] = useState(null);

    const update_members = async () => 
        set_members(await fetch_json("auth", `/authz/group/${group}`));
    useEffect(update_members, []);

    const new_m = useRef(null);

    const del_m = async member => {
        const ok = await fetch_json("auth", 
            `/authz/group/${group}/${member}`, "DELETE");
        set_msg(ok ? "Deleted member" : "Failed");
        update_members();
    };
    const add_m = async () => {
        const member = new_m.current?.value;
        if (!UUID.validate(member)) {
            set_msg("Bad UUID");
            return;
        }
        const ok = await fetch_json("auth",
            `/authz/group/${group}/${member}`, "PUT");
        set_msg(ok ? "Added member" : "Failed");
        new_m.current.value = "";
        update_members();
    };

    return members ? html`
        <table>
        ${ members.map(m => html`
            <tr>
                <td><${Obj} obj=${m} key=${m}/></td>
                <td><button onClick=${() => del_m(m)}>Delete</button></td>
            </tr>
        `) }
            <tr>
                <td><input type="text" size=40 ref=${new_m}/></td>
                <td><button onClick=${add_m}>Add</button></td>
            </tr>
        </table>
        <p>${msg}</p>
    ` : html`<b>...</b>`;
}

function Effective (props) {
    const [princs, set_princs] = useState(null);

    useEffect(async () => set_princs(await fetch_json("auth", "/authz/effective")), []);

    return princs ? html`
        <dl>
            ${ princs.map(a => html`
                <${Opener} title=${html`<${Clip}>${a}<//>`} key=${a}><${EffPrinc} princ=${a}/><//>`) }
        </dl>
    ` : html`<b>...</b>`;
}

function EffPrinc (props) {
    const {princ} = props;
    const [eff, set_eff] = useState(null);

    useEffect(async () => {
        const e_princ = encodeURIComponent(princ);
        const list = await fetch_json("auth", `/authz/effective/${e_princ}`);
        sort_acl(list);
        set_eff(list);
    }, []);

    return eff ? html`
        <table>
            <tr><th>Permission</th><th>Target</th></tr>
            ${ eff.map(a => html`
            <tr>
                <td><${Obj} obj=${a.permission}/></td>
                <td><${Obj} obj=${a.target}/></td>
            </tr>
            `) }
        </table>
    ` : html`<b>...</b>`;
}

function Obj (props) {
    const {obj} = props;
    const [name, set_name] = useState("...");

    useEffect(async () => set_name(await get_name(obj)), []);

    return html`
        <${Clip}>${obj}<//><br/>${name}
    `;
}

function LoadDump (props) {
    const [msg, set_msg] = useState("");

    const dump_r = useRef(null);
    const file_r = useRef(null);

    const load = async () => {
        const dump = JSON.parse(dump_r.current?.value);
        if (dump == null) {
            set_msg("Error reading dump from textbox");
            return;
        }

        const ok = await fetch_json("auth", "/authz/load", "POST", dump);
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
        <p><textarea cols=80 rows=24 ref=${dump_r}></textarea></p>
        <p><input type=file ref=${file_r} onChange=${read_file}></input></p>
        <p><button onClick=${load}>Load JSON dump</button> ${msg}</p>
    `;
}

Creds = await (await fetch("/editor/creds")).text();
console.log(`Got creds [${Creds}]`);
Services = await (await fetch("/editor/services")).json();
render(html`<${Editor}/>`, document.body);
