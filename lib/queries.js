/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component service
 * Database queries class.
 * Copyright 2022 AMRC
 */

const UUID_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function valid_uuid(uuid) {
    if (UUID_rx.test(uuid))
        return true;
    console.log(`Ignoring invalid UUID [${uuid}]`);
    return false;
}

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

/* Queries is a separate class, because sometimes we want to query on
 * the database directly, and sometimes we need to query using a query
 * function for a transaction. The model inherits from this class. */
export default class Queries {
    static DBVersion = 9;

    constructor(query) {
        this.query = query;
    }

    async find_or_create(table, uuid) {
        if (!valid_uuid(uuid)) return null;

        /* I would like to use INSERT RETURNING but I can't because it
         * returns nothing if we ON CONFLICT DO NOTHING. If I switched
         * to REPEATABLE READ I could do the select first, perhaps. */
        await this.query(`
            insert into ${table} (uuid)
            values ($1) on conflict do nothing
        `, [uuid]);

        let dbr = await this.query(`
            select id
            from ${table}
            where uuid = $1
        `, [uuid]);

        return dbr.rows[0].id;
    }

    /* Search */

    async search(q) {
        const dbr = await this.query(`
            select *
            from device_status
        `, []);

        return dbr.rows;
    }

    /* Devices */

    async devices() {
        let dbr = await this.query(`
            select uuid
            from device
        `);

        return dbr.rows.map(r => r.uuid);
    }

    async device_info_by_uuid(uuid) {
        if (!valid_uuid(uuid)) return null;

        const dbr = await this.query(`
            select *
            from device_status
            where uuid = $1
        `, [uuid]);

        if (dbr.rowCount == 0) return null;
        return dbr.rows[0];
    }

    /* Sessions */

    async session_notification_info(id) {
        const dbr = await this.query(`
            select dev.uuid device,
                   adr.group_id,
                   adr.node_id,
                   adr.device_id,
                   ses.next_for_device,
                   ses.next_for_address,
                   prev.id  prev_for_device
            from session ses
                     join device dev on dev.id = ses.device
                     join address adr on adr.id = ses.address
                     left join session prev on prev.next_for_device = ses.id
            where ses.id = $1
        `, [id]);

        return dbr.rows[0];
    }

    async is_addr_online(addr) {
        const dbr = await this.query(`
            select ses.online
            from session ses
                     join address adr on adr.id = ses.address
            where adr.group_id = $1
              and adr.node_id = $2
              and adr.device_id = $3
              and ses.next_for_address is null
        `, [addr.group, addr.node, addr.device ?? ""]);

        return dbr.rows[0]?.online;
    }

    async sessions(q) {
        /* XXX This endpoint is disabled for now, while I decide what to do about storing the
         * potentially large volume of session history. */
        return [];

//        let dbr = await this.db.query(`
//            select sess.group_id, sess.node_id, sess.device_id,
//                sess.start, sess.finish, 
//                coalesce(schs.schemas, '{}') schemas
//            from session sess
//                join device dev on dev.id = sess.device
//                left join session_schemas schs on schs.session = sess.id
//            where dev.uuid = $1
//                and ($2::timestamp is null or coalesce(sess.finish, sess.start) >= $2)
//                and ($3::timestamp is null or sess.start <= $3)
//            order by sess.start desc
//        `, [q.device, q.start, q.finish]);
//
//        return dbr.rows;
    }

    /* Schema */

    async find_schema_changes(sessid) {
        const dbr = await this.query(`
            select coalesce(osch.schemas, '{}') oschemas,
                   coalesce(nsch.schemas, '{}') nschemas
            from session osess
                     left join session_schemas osch on osch.session = osess.id
                     left join session_schemas nsch
                               on nsch.session = osess.next_for_device
            where osess.id = $1
        `, [sessid]);

        const row = dbr.rows[0];
        const old_sch = new Set(row.oschemas);
        const new_sch = new Set(row.nschemas);
        return sym_diff(old_sch, new_sch);
    }

    async session_schemas(id) {
        const dbr = await this.query(`
            select sch.uuid
            from schema_used su
                     join schema sch on sch.id = su.schema
            where su.session = $1
        `, [id]);

        return dbr.rows.map(r => r.uuid);
    }

    async record_schema(session, schema) {
        const schid = await this.find_or_create("schema", schema);
        if (schid == null) return;

        await this.query(`
            insert into schema_used (session, schema)
            values ($1, $2)
        `, [session, schid]);
    }

    async schemas() {
        let dbr = await this.query(`
            select uuid
            from schema
        `);

        return dbr.rows.map(r => r.uuid);
    }

    async schema_devices(schema) {
        if (!valid_uuid(schema))
            return [];

        let dbr = await this.query(`
            select dev.uuid
            from schema_used u
                     join schema sch on sch.id = u.schema
                     join session ses on ses.id = u.session
                     join device dev on dev.id = ses.device
            where sch.uuid = $1
              and ses.next_for_device is null
        `, [schema]);

        return dbr.rows.map(r => r.uuid);
    }

    /* Address */

    async find_or_create_address(addr) {
        const {group, node} = addr;
        const device = addr.device ?? "";

        await this.query(`
            insert into address (group_id, node_id, device_id)
            values ($1, $2, $3) on conflict do nothing
        `, [group, node, device]);

        const dbr = await this.query(`
            select id
            from address
            where group_id = $1
              and node_id = $2
              and device_id = $3
        `, [group, node, device]);

        return dbr.rows[0].id;
    }

    async addr_groups() {
        const dbr = await this.query(`
            select distinct group_id
            from address
        `);

        return dbr.rows.map(r => r.group_id);
    }

    async addr_nodes(group) {
        const dbr = await this.query(`
            select distinct node_id
            from address
            where group_id = $1
              and device_id = ''
        `, [group]);

        return dbr.rows.map(r => r.node_id);
    }

    async addr_devices(group, node) {
        const dbr = await this.query(`
            select distinct device_id
            from address
            where group_id = $1
              and node_id = $2
              and device_id != ''
        `, [group, node]);

        return dbr.rows.map(r => r.device_id);
    }

    /* Find UUID of the device to have most recently used this address. */
    async addr_uuid(group, node, device) {
        const dbr = await this.query(`
            select dev.uuid
            from session ses
                     join device dev on dev.id = ses.device
                     join address adr on adr.id = ses.address
            where adr.group_id = $1
              and adr.node_id = $2
              and adr.device_id = $3
              and ses.next_for_address is null
        `, [group, node, device]);

        return dbr.rows[0]?.uuid;
    }

    /* Service */

    async services() {
        const dbr = await this.query(`
            select uuid
            from service
            order by uuid
        `);

        return dbr.rows.map(r => r.uuid);
    }

    async service_providers(service) {
        if (!valid_uuid(service))
            return [];

        let dbr = await this.query(`
            select dev.uuid device, prv.url
            from service_provider prv
                     join service srv on srv.id = prv.service
                     left join device dev on dev.id = prv.device
            where srv.uuid = $1
        `, [service]);

        return dbr.rows;
    }

    async service_from_provider(id) {
        const dbr = await this.query(`
            select srv.uuid
            from service_provider prv
                     join service srv on srv.id = prv.service
            where prv.id = $1
        `, [id]);

        return dbr.rows[0]?.uuid;
    }

    async record_service(opts) {
        if (!valid_uuid(opts.service) || !valid_uuid(opts.owner))
            return null;

        const srv = await this.find_or_create("service", opts.service);
        const own = await this.find_or_create("principal", opts.owner);

        /* Insert if we can; otherwise only update if we are changing
         * something. This both avoids unnecessary churn on the DB and
         * allows us to do correct change-notify over MQTT. */
        const ins = await this.query(`
            insert into service_provider as prv
                (service, owner, device, url)
            values ($1, $2, $3, $4)
            on conflict (service, owner) do
            update
                set device = $3, url = $4
            where prv.device is distinct
            from $3
                or prv.url is distinct
            from $4
                returning 1 ok
        `, [srv, own, opts.device, opts.url]);

        return ins.rowCount == 1 ? opts.service : false;
    }

    async service_advert(service, owner) {
        if (!valid_uuid(service) || !valid_uuid(owner))
            return null;

        const dbr = await this.query(`
            select svp.device, svp.url
            from service_provider svp
                     join service sv on sv.id = svp.service
                     join principal pr on pr.id = svp.owner
            where sv.uuid = $1
              and pr.uuid = $2
        `, [service, owner]);
        return dbr.rows[0];
    }

    async find_service_url(service) {
        if (!valid_uuid(service))
            return null;

        const dbr = await this.query(`
            select svp.url
            from service_provider svp
                     join service sv on sv.id = svp.service
            where sv.uuid = $1
        `, [service]);

        return dbr.rows.map(s => s.url);
    }

    /* Birth/death */

    async find_or_create_missing_uuid(addrid) {
        await this.query(`
            insert into missing_uuid (address)
            values ($1) on conflict do nothing
        `, [addrid]);

        let dbr = await this.query(`
            select uuid
            from missing_uuid
            where address = $1
        `, [addrid]);

        return dbr.rows[0].uuid;
    }

    async record_birth(opts) {
        const schid = await this.find_or_create("schema", opts.top_schema);

        /* Check noone else has claimed this device already? */

        const dbr = await this.query(`
            insert into session (device, address, start, top_schema)
            values ($1, $2, $3, $4) returning id
        `, [opts.devid, opts.addrid, opts.time, schid]);

        if (dbr.rowCount != 1)
            throw("Recording session start failed");
        const sess = dbr.rows[0].id;

        /* This session replaces old sessions for this device/address. */
        await this.query(`
            update session
            set next_for_device = $1
            where device = $2
              and next_for_device is null
              and id != $1
        `, [sess, opts.devid]);
        await this.query(`
            update session
            set next_for_address = $1
            where address = $2
              and next_for_address is null
              and id != $1
        `, [sess, opts.addrid]);

        return sess;
    }

    /* This will close all child device sessions when closing a node
     * session. */
    async record_death(time, addr) {
        return await this.query(`
            update session ses
            set finish = $1 from device dev, address adr
            where dev.id = ses.device
              and adr.id = ses.address
              and adr.group_id = $2
              and adr.node_id = $3
              and ($4 = ''
               or adr.device_id = $4)
              and ses.online
                returning dev.uuid
                , adr.group_id
                , adr.node_id
                , adr.device_id
        `, [time, addr.group, addr.node, addr.device ?? ""]);
    }

    /* Alerts */
    async find_alert_type (uuid) {
        if (!valid_uuid(uuid)) return;

        const find = await this.query(`
            select id from alert_type
            where uuid = $1
        `, [uuid]);
        if (find.rowCount > 0)
            return find.rows[0].id;

        const create = await this.query(`
            insert into alert_type (uuid)
            values ($1)
            returning id
        `, [uuid]);
        return create.rows[0].id;
    }

    async record_alert (dev_id, opts) {
        if (!valid_uuid(opts.uuid)) return;

        opts = {
            ...opts,
            dev_id,
            type_id:    await this.find_alert_type(opts.type),
        };
        const find = await this.query(`
            select id from alert
            where uuid = $1
        `, [opts.uuid]);
        if (find.rowCount > 0) {
            const id = find.rows[0].id;
            await this.update_alert_info(id, opts);
        }
        else {
            await this.create_alert(opts);
        }
    }

    create_alert (opts) {
        return this.query(`
            insert into alert (
                uuid, device, atype, metric, active)
            values($1, $2, $3, $4, $5)
            returning id
        `, [opts.uuid, opts.dev_id, opts.type_id, opts.metric, opts.active]);
    }

    update_alert_info (id, opts) {
        return this.query(`
            update alert
            set device = $2, atype = $3, metric = $4, active = $5
            where id = $1
        `, [id, opts.dev_id, opts.type_id, opts.metric, opts.active]);
    }

    update_alert_active (uuid, active) {
        return this.query(`
            update alert
            set active = $2
            where uuid = $1
        `, [uuid, active]);
    }
}
