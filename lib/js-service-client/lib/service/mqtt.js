/*
 * Factory+ NodeJS Utilities
 * GSSAPI MQTT connection.
 * Copyright 2022 AMRC
 */

import { BasicSparkplugNode } from "../sparkplug/basic-node.js";

import { GSS, MQTT } from "../deps.js";
import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

async function gss_init (host) {
    const ctx = GSS.createClientContext({
        server: `mqtt@${host}`,
    });
    const buf = await GSS.initSecContext(ctx);

    return [ctx, buf];
}

function get_verb_from (opts) {
    return opts.verbose ? console.log 
        : opts.log ?? (m => {});
}

/* Although MQTT.js supports MQTT5 extended auth, the support has not
 * really been thought through. The initial auth-data must be supplied
 * before a connection attempt is made, meaning we must build an AP-REQ
 * before we even know if the MQTT server is online. Then, we can't use
 * the auto-reconnect functionality, as this gives no opportunity to
 * create a new AP-REQ, as that might perform network activity and must
 * be awaited. So that has to be reimplemented manually based on
 * watching for the 'close' event. If we wanted to support a GSSAPI
 * exchange that took more than one step (e.g. SPNEGO) this would be
 * even more convoluted. */

/* Don't use .on("connect") on the object returned from here; we need
 * that event to complete the GSS auth. Use .on("authenticated") instead,
 * which doesn't fire until after we have finished authenticating the
 * server properly. */

/* This export is deprecated. Go via ServiceClient instead, as this
 * will allow fallback to username/password if this is all we have. */
export async function gss_mqtt (url, opts) {
    opts ??= {};
    const host = new URL(url).hostname;
    const verb = get_verb_from(opts);

    /* Has the connection deliberately been closed? */
    let ending = false;

    /* These are renewed every time we reconnect as Kerberos won't let
     * us replay AP-REQ packets. */
    let [ctx, buf] = await gss_init(host);

    const mqtt = MQTT.connect(url, {
        reconnectPeriod: 3000,
        protocolVersion: 5,
        ...opts,
        properties: {
            ...opts.properties,
            authenticationMethod: "GSSAPI",
            authenticationData: buf,
        },
    });
    mqtt.on("packetreceive", pkt => {
        if (pkt.cmd != "connack")
            return;
        verb("MQTT clearing GSS creds");
        mqtt.options.properties.authenticationData = "";
    });
    mqtt.on("connect", ack => {
        //verb("Got CONNACK: %o", ack);
        const srv_buf = ack.properties.authenticationData;
        GSS.initSecContext(ctx, srv_buf).then(next => {
            if (next.length)
                throw "GSS auth took more than one step";
            /* XXX I'm not sure this will properly abort if mutual auth
             * fails. We may need to be more drastic. */
            if (!ctx.isComplete())
                throw "MQTT server failed to authenticate itself!";
            verb("MQTT connected");
            mqtt.emit("gssconnect", ack);
            mqtt.emit("authenticated", ack);
        });
    });
    mqtt.on("close", () => {
        if (ending) return;

        /* We clear the authData when we get a CONNACK (successful or
         * not). We don't need to do anything if our AP-REQ hasn't been
         * used yet. */
        if (mqtt.options.properties.authenticationData != "")
            return;

        /* XXX This will not necessarily complete before the client
         * sends the CONNECT packet. There is nothing we can do about
         * this with the existing MQTT.js API. The connect attempt will
         * fail (GSS replay) and we will try again.
         *
         * Previously this code bypassed the auto-reconnect logic and
         * explicitly reconnected after fetching the AP-REQ. But this
         * also disabled the auto-resubscribe logic, which is not
         * helpful.
         */
        verb("MQTT fetching new GSS creds");
        gss_init(host)
            .then(newgss => {
                verb("MQTT setting new GSS creds");
                [ctx, buf] = newgss;
                mqtt.options.properties.authenticationData = buf;
            });
    });
    mqtt.on("end", () => {
        verb("MQTT end");
        ending = true;
    });

    return mqtt;
}

async function basic_mqtt(url, opts) {
    const verb = get_verb_from(opts);

    verb(`Basic auth with ${opts.username}`);
    const mqtt = MQTT.connect(url,{
        protocolVersion: 5,
        ...opts,
    });
    mqtt.on("connect", ack => {
        verb("MQTT connected");
        mqtt.emit("authenticated", ack);
    });
    mqtt.on("close", () => {
        verb("MQTT connection closed");
    });
    return mqtt;
}

/** MQTT service interface.

If the `browser` option is set to true in the ServiceClient options then
URLs resolved from Discovery will have the `mqtt` and `mqtts` schemes
replaced with `ws` or `wss` respectively.

*/
export class MQTTInterface extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);

        this.browser = !!fplus.opts.browser;
    }

    /** Create a new connection to the MQTT broker.
     * If we have Basic credentials this will perform normal MQTT
     * authentication. If we have GSSAPI credentials this will use MQTT5
     * extended auth with the `GSSAPI ` method; this is only supported
     * by Factory+ brokers.
     *
     * The GSSAPI support uses the `connect` event to support the
     * authentication exchange. The returned client will emit
     * `authenticated` when authentication is complete.
     *
     * @arg opts Options to pass to the MQTT constructor
     * @returns A Promise to an MQTT client object.
     */
    async mqtt_client (opts) {
        opts ??= {};

        this.debug.log("mqtt", "Looking up MQTT broker URL");
        /* XXX Call service_urls instead and find one that works. */
        let url = opts.host;
        url ??= await this.fplus.service_url(Service.MQTT);

        if (url == null)
            return null;
        if (this.browser)
            url = url.replace(/^mqtt(?=s?:)/, "ws");

        this.debug.log("mqtt", `Connecting to broker ${url}`);

        const { username, password } = this.fplus.opts;
        const mqopts = {
            ...opts,
            username, password,
            /* I had this here, but as of mqttjs v5 it is producing a
             * lot of rather verbose logging, so I've removed it. */
            //log: (...a) => this.debug.log("mqtt", ...a),
        };
        return username && password
            ? await basic_mqtt(url, mqopts)
            : await gss_mqtt(url, mqopts);
    }

    /** Construct a BasicSparkplugNode.
     * This returns a BasicSparkplugNode which will use an MQTT
     * connection provided by this object.
     * @arg opts Options for BasicSparkplugNode.
     * @returns A Promise to a BasicSparkplugNode object.
     */
    async basic_sparkplug_node (opts) {
        return new BasicSparkplugNode({
            debug:          this.debug,
            ...opts,
            mqttFactory:    will => this.mqtt_client({ ...opts, will }),
        });
    }

    /** Construct a SparkplugApp.
     * This loads `@amrc-factoryplus/sparkplug-app` and constructs a
     * SparkplugApp object using our ServiceClient.
     * @returns A Promise to a SparkplugApp object.
     */
    async sparkplug_app () {
        if (!this._sparkplug_app) {
            const spa = await import("@amrc-factoryplus/sparkplug-app");
            const app = new spa.SparkplugApp({ fplus: this.fplus });
            this._sparkplug_app = await app.init();
        }
        return this._sparkplug_app;
    }
}
