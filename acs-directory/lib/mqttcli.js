/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component service
 * MQTT client connection
 * Copyright 2021 AMRC
 */

import timers from "timers/promises";
import async from "async";
import Long from "long";

import {
    Address, Debug, 
    MetricBranch, MetricBuilder, MetricTree, 
    SpB, Topic, UUIDs
} from "@amrc-factoryplus/utilities";
import { Device_Info } from "./constants.js";
import { Schema } from "./uuids.js";

function sym_diff(one, two) {
    const diff = new Set(one);
    for (let el of two) {
        if (diff.has(el))
            diff.delete(el);
        else
            diff.add(el);
    }
    return diff;
}

function map_get_or_create(map, key, factory) {
    if (map.has(key)) return map.get(key);
    const rv = factory();
    map.set(key, rv);
    return rv;
}

function ts_date (ts) {
    const val = Long.isLong(ts) ? ts.toNumber() : ts;
    return new Date(val);
}

function for_each_metric(tree, action) {
    for (const [name, metric] of Object.entries(tree)) {
        if (metric instanceof MetricBranch) {
            if (metric.$metric)
                action(tree, name, metric.$metric)
            for_each_metric(metric, action);
        }
        else {
            action(tree, name, metric);
        }
    }
}

function for_each_instance (tree, action, parent) {
    const schema = tree.Schema_UUID?.value;
    const uuid = tree.Instance_UUID?.value;
    if (schema && uuid) {
        action(schema, uuid, tree, parent);
        parent = uuid;
    }
    for (const metric of Object.values(tree)) {
        if (!(metric instanceof MetricBranch))
            continue;
        for_each_instance(metric, action, parent);
    }
}

export default class MQTTCli {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.model = opts.model;

        this.url = opts.url;
        this.silent = opts.silent;

        /* .bound always binds a level */
        this.log = this.fplus.debug.log.bind(this.fplus.debug);

        this.seq = 0;

        this.online = new Set();
        this.rebirths = {
            pending: {},
            sent: {},
        };
        this.alerts = new Map();
    }

    async init() {
        const ids = await this.fplus.Auth.find_principal();
        if (!ids || !ids.uuid || !ids.sparkplug)
            throw new Error("Can't find my identity!");

        this.device_uuid = ids.uuid;
        this.address = ids.sparkplug;

        await this.model.init();

        this.msg_q = async.queue(this.on_queued_message.bind(this));
        this.msg_q.error(this.on_queue_error.bind(this));

        this.notify_client = this.model.notify_client(
            ["mqtt"], this.on_notify.bind(this));

        return this;
    }

    will() {
        if (this.silent) return undefined;

        const ndeath = {
            timestamp: Date.now(),
            metrics: MetricBuilder.death.node([]),
        };
        const will = SpB.encodePayload(ndeath);

        return {
            topic: this.address.topic("DEATH"),
            payload: will,
            qos: 0,
            retain: false,
        };
    }

    async run() {
        if (this.silent)
            this.log("mqtt", "Running in monitor-only mode.");

        const mqtt = await this.fplus.mqtt_client({
            verbose: true,
            will: this.will(),
        });
        this.mqtt = mqtt;

        //mqtt.on("packetreceive", this.mqtt_debug.bind(this));
        mqtt.on("gssconnect", this.on_connect.bind(this));
        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("message", this.on_message.bind(this));

        mqtt.subscribe("spBv1.0/#");
    }

    encode_metrics(metrics, with_uuid) {
        const payload = {
            timestamp: Date.now(),
            metrics: metrics,
            seq: this.seq,
        };
        this.seq = (this.seq < 255) ? (this.seq + 1) : 0;
        if (with_uuid)
            payload.uuid = UUIDs.FactoryPlus;

        return SpB.encodePayload(payload);
    }

    publish(kind, metrics, with_uuid) {
        const topic = this.address.topic(kind);
        const payload = this.encode_metrics(metrics, with_uuid);

        this.mqtt.publish(topic, payload);
    }

    async mqtt_debug(packet) {
        this.log("mqtt", `MQTT packet: ${packet.cmd}`);
        if (packet.cmd != "connack")
            return;
        console.dir(packet);
    }

    async on_connect() {
        this.log("mqtt", "Connected to MQTT broker.");

        await this.rebirth();
    }

    async rebirth() {
        if (this.silent)
            return;

        this.seq = 0;
        const Birth = MetricBuilder.birth;
        const metrics = Birth.node([]);
        Birth.command_escalation(metrics);
        metrics.push.apply(metrics, [
            {name: "Device_Information/Schema_UUID", type: "UUID", value: UUIDs.Schema.Device_Information},
            {name: "Device_Information/Manufacturer", type: "String", value: Device_Info.Manufacturer},
            {name: "Device_Information/Model", type: "String", value: Device_Info.Model},
            {name: "Device_Information/Serial", type: "String", value: Device_Info.Serial},

            {name: "Schema_UUID", type: "UUID", value: UUIDs.Schema.Service},
            {name: "Instance_UUID", type: "UUID", value: this.device_uuid},
            {name: "Service_UUID", type: "UUID", value: UUIDs.Service.Directory},
            {name: "Service_URL", type: "String", value: this.url},

            {name: "Last_Changed/Device_UUID", type: "UUID", value: ""},
            {name: "Last_Changed/Device_Address", type: "String", value: ""},
            {name: "Last_Changed/Schema_Usage", type: "UUID", value: ""},
            {name: "Last_Changed/Service", type: "UUID", value: ""},
        ]);

        this.log("mqtt", `Publishing birth certificate`);
        this.publish("BIRTH", metrics, true);
    }

    on_error(error) {
        this.log("mqtt", "MQTT error: %o", error);
    }

    on_message(topicstr, message) {
        let topic = Topic.parse(topicstr);
        if (topic === null) {
            this.log("mqtt", `Ignoring bad topic ${topicstr}`);
            return;
        }

        let payload;
        try {
            payload = SpB.decodePayload(message);
        } catch {
            this.log("mqtt", `Bad payload on topic ${topicstr}`);
            return;
        }

        /* Push messages to a queue so they are processed serially. I
         * think this is stricter than is necessary: probably messages
         * from different addresses could be processed in parallel. But
         * this removes the concurrency problem for now, and if we have
         * problems handling the load that can be looked at later. */
        this.msg_q.push({topic, payload});
    }

    async on_queued_message(qitem) {
        const {topic, payload} = qitem;
        const addr = topic.address;

        switch (topic.type) {
            case "BIRTH":
                await this.on_birth(addr, payload);
                break;
            case "DEATH":
                await this.on_death(addr, payload);
                break;
            case "DATA":
                await this.on_data(addr, payload);
                break;
            case "CMD":
                await this.on_command(addr, payload);
                break;
            default:
                this.log("mqtt", `Unknown Sparkplug message type ${topic.type}!`);
        }
    }

    on_queue_error(error, qitem) {
        this.log("mqtt", "Error handling %s: %o", qitem.topic, error);
    }

    on_notify(msg) {
        this.log("change", `NOTIFY: [${msg.channel}] [${msg.payload}]`);
        const [table, idx] = msg.payload.split(":");
        const id = Number.parseInt(idx);
        if (Number.isNaN(id)) {
            this.log("change", `Bad table row id [${idx}]`);
            return;
        }

        switch (table) {
            case "alert":
                this.on_alert_notify(id);
                break;
            case "link":
                this.on_link_notify(id);
                break;
            case "session":
                this.on_session_notify(id);
                break;
            case "service_provider":
                this.on_service_notify(id);
                break;
            default:
                this.log("change", `Notify for unknown table ${table}`);
        }
    }

    async on_alert_notify (id) {
        const alrt = await this.model.alert_by_id(id);

        this.publish_changed([["Alert_Type", alrt.type]]);
    }

    async on_link_notify (id) {
        const lnk = await this.model.link_by_id(id);
        this.publish_changed([["Link_Relation", lnk.relation]]);
    }

    async on_session_notify(id) {
        const session = await this.model.session_notification_info(id);
        const schemas = await this.model.session_schemas(id);

        const notify = [];

        /* Only publish change notifications for sessions which are
         * still current. We will get another notification for the
         * new current session and don't want to publish twice. */
        if (session.next_for_device == null)
            notify.push(["Device_UUID", session.device]);

        if (session.next_for_address == null) {
            const addr = new Address(
                session.group_id, session.node_id, session.device_id);
            notify.push(["Device_Address", addr.toString(), "String"]);
        }

        const prev = session.prev_for_device;
        const oschs = prev == null ? []
            : await this.model.session_schemas(prev);

        for (const sch of sym_diff(oschs, schemas))
            notify.push(["Schema_Usage", sch]);

        if (notify.length)
            this.publish_changed(notify);
    }

    async on_service_notify(id) {
        const srv = await this.model.service_from_provider(id);
        if (srv == null) return;

        this.publish_changed([["Service", srv]]);
    }

    find_schemas(metrics) {
        const schemas = new Set();
        this.find_schemas_in_branch(schemas, metrics);
        return schemas;
    }

    find_schemas_in_branch(schemas, branch) {
        for (let [name, metric] of Object.entries(branch)) {
            if (metric instanceof MetricBranch) {
                this.find_schemas_in_branch(schemas, metric);
                continue;
            }
            if (name === "Schema_UUID")
                schemas.add(metric.value);
        }
    }

    find_service(metrics) {
        if (metrics.Schema_UUID?.value != UUIDs.Schema.Service)
            return;

        if (metrics.Service_UUID == undefined)
            return;

        return {
            uuid: metrics.Service_UUID.value,
            url: metrics.Service_URL?.value,
        };
    }

    find_alerts(metrics, timestamp) {
        const alerts = [];

        for_each_instance(metrics, (schema, uuid, branch) => {
            if (schema != Schema.Alert) return;

            const active = branch.Active;
            alerts.push({
                uuid,
                type:   branch.Type.value,
                metric: active.name,
                active: active.value,
                alias:  active.alias,
                stamp:  ts_date(active.timestamp ?? timestamp),
            });
        });

        this.log("alerts", "Found alerts: %o", alerts);
        return alerts;
    }

    record_alert_metrics(address, alerts) {
        const metrics = map_get_or_create(
            this.alerts, address, 
            () => ({ name: new Map(), alias: new Map() }));

        for (const alrt of alerts.values()) {
            metrics.name.set(alrt.metric, alrt.uuid);
            if (alrt.alias != undefined) {
                metrics.alias.set(alrt.alias, alrt.uuid);
            }
        }
    }

    handle_alert_updates(address, payload) {
        const alerts = this.alerts.get(address);
        if (!alerts) return;

        const updates = payload.metrics.flatMap(m => {
            const uuid = "alias" in m 
                ? alerts.alias.get(m.alias) : alerts.name.get(m.name);
            if (!uuid) return [];
            const stamp = ts_date(m.timestamp ?? payload.timestamp);
            return [[uuid, m.value, stamp]];
        });

        this.model.update_alerts(updates);
    }

    find_links(metrics, timestamp) {
        const links = [];

        for_each_instance(metrics, (schema, uuid, tree, parent) => {
            if (schema != Schema.Link) return;
            links.push({
                uuid,
                source:     parent,
                relation:   tree.Relation.value,
                target:     tree.Target.value,
            });
        });

        this.log("links", "Found links: %o", links);
        return links;
    }

    publish_changed(changes) {
        this.log("change", "Publish changed: %o", changes);
        this.publish("DATA", changes.map(
            ([name, value, type]) => ({
                name: `Last_Changed/${name}`,
                type: type ?? "UUID",
                value: value,
            })));
    }

    async on_birth(address, payload) {
        this.log("device", `Registering BIRTH for ${address}`);
        this.online.add(address);

        let tree;
        if (payload.uuid === UUIDs.FactoryPlus) {
            tree = new MetricTree(payload);
        } else {
            this.log("device", "Ignoring all metrics in non-F+ BIRTH");
            tree = {};
        }

        const alerts = this.find_alerts(tree, payload.timestamp);
        this.record_alert_metrics(address, alerts);

        await this.model.birth({
            time: ts_date(payload.timestamp ?? 0),
            address,
            uuid: tree.Instance_UUID?.value,
            top_schema: tree.Schema_UUID?.value,
            schemas:    this.find_schemas(tree),
            service:    this.find_service(tree),
            alerts,
            links:      this.find_links(tree),
        });

        this.log("device", `Finished BIRTH for ${address}`);
    }

    async on_death(address, payload) {
        const time =  ts_date(payload.timestamp ?? 0);

        this.log("device", `Registering DEATH for ${address}`);

        this.alerts.delete(address);
        this.online.delete(address);
        await this.model.death({address, time});

        this.log("device", `Finished DEATH for ${address}`);
    }

    async on_command(addr, payload) {
        if (!addr.equals(this.address)) {
            //console.log(`Received CMD for ${addr}`);
            return;
        }

        for (let m of payload.metrics) {
            switch (m.name) {
                case "Node Control/Rebirth":
                    await this.rebirth();
                    break;
                default:
                    this.log("mqtt", `Received unknown CMD: ${m.name}`);
                /* Ignore for now */
            }
        }
    }

    /* Properly I would like not to have to subscribe to DATA topics at
     * all. But since we don't have any reliability system here, I have
     * to copy Ignition's trick of rebirthing anyone I don't recognise.
     */
    async on_data(addr, payload) {
        /* Don't await this, allow it to run on its own */
        this.handle_alert_updates(addr, payload);

        if (this.silent) return;
        if (!await this.do_we_rebirth(addr)) return;

        /* XXX always rebirth the whole edge node? */
        const node = addr.parent_node();

        this.log("rebirth", `Sending (escalated) rebirth request to ${node}`);
        const metrics = MetricBuilder.data.command_escalation(
            //addr, 
            //(addr.isDevice() ? "Device Control/Rebirth" : "Node Control/Rebirth"),
            node, "Node Control/Rebirth", "true",
        );
        this.publish("DATA", metrics);
    }

    /* We don't want to attempt rebirth too often (Ignition may be doing
     * it too / the device may be broken). So (1) give the device a
     * chance to rebirth on its own (or via Ignition) and (2) don't
     * rebirth any device too often. */
    async do_we_rebirth(addr) {
        const {pending, sent} = this.rebirths;

        //this.log("rebirth", `Checking whether we should rebirth ${addr}`);

        /* If we've rebirthed this device in the last 5 minutes, don't
         * do it again. */
        if (addr in sent) {
            if (sent[addr] < Date.now() - 300000)
                delete (sent[addr]);
            else
                return false;
        }

        /* If we've got a pending rebirth, don't send another. */
        if (pending[addr]) return false;

        /* If we think this device is online, everything's OK. This will
         * rebirth any device we haven't seen a birth for, even if the
         * database says it's online. This is important because we might
         * have the wrong schema information. */
        if (this.online.has(addr) || pending[addr]) return false;

        /* Mark that we're working on this device and wait 5-10s to see if
         * it rebirths on its own. */
        pending[addr] = 1;
        await timers.setTimeout(5000 + Math.random() * 5000);

        /* Clear our marker first so we retry next time */
        delete (pending[addr]);
        if (this.online.has(addr)) return false;

        sent[addr] = Date.now();
        return true;
    }
}
