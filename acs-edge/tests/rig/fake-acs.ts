/*
 * ACS Edge Agent
 * Split-driver cluster rig: an in-memory ConfigDB for tests
 * Copyright 2026 University of Sheffield
 *
 * Just the calls the loader, the remover and service-setup's split
 * driver move make, with the status codes the real client throws.
 */

class NotFound extends Error {
    status = 404
}

export class FakeConfigDB {
    /* app -> object -> config */
    configs:    Map<string, Map<string, any>> = new Map()
    /* object -> class */
    objects:    Map<string, string> = new Map()
    writes = 0

    app (app: string) {
        let m = this.configs.get(app);
        if (!m) this.configs.set(app, m = new Map());
        return m;
    }

    async get_config (app: string, obj: string) {
        const v = this.app(app).get(obj);
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }

    async get_config_with_etag (app: string, obj: string) {
        const v = await this.get_config(app, obj);
        return [v, v === undefined ? undefined : `"${JSON.stringify(v).length}"`];
    }

    async put_config (app: string, obj: string, json: any) {
        this.writes++;
        this.app(app).set(obj, JSON.parse(JSON.stringify(json)));
    }

    async delete_config (app: string, obj: string) {
        if (!this.app(app).delete(obj)) throw new NotFound(`No ${app} for ${obj}`);
        this.writes++;
    }

    async list_configs (app: string) {
        return [...this.app(app).keys()];
    }

    async get_all_configs (app: string) {
        return new Map([...this.app(app)].map(([k, v]) =>
            [k, JSON.parse(JSON.stringify(v))]));
    }

    async create_object (klass: string, obj: string) {
        const had = this.objects.get(obj);
        if (had && had != klass) throw new Error(`${obj} is a ${had}`);
        if (!had) this.writes++;
        this.objects.set(obj, klass);
        return obj;
    }

    async delete_object (obj: string) {
        if (!this.objects.delete(obj)) throw new NotFound(`No object ${obj}`);
        for (const m of this.configs.values())
            if (m.has(obj)) throw new Error(`${obj} still has configs`);
        this.writes++;
    }

    /* Every config of an object, for checking nothing is left. */
    of (obj: string) {
        return [...this.configs].filter(([, m]) => m.has(obj)).map(([a]) => a);
    }
}

/* Secrets sealed and removed through the Manager's endpoint. */
export class FakeFetch {
    secrets:    Map<string, string> = new Map()

    async fetch (opts: { url: string, method: string, body?: string }) {
        const key = opts.url.replace(/^v1\/cluster\//, "");
        if (opts.method == "PUT") this.secrets.set(key, String(opts.body));
        else if (opts.method == "DELETE") this.secrets.delete(key);
        return { ok: true, status: 204 };
    }
}

export function fake_fplus () {
    const fplus = {
        ConfigDB:   new FakeConfigDB(),
        Fetch:      new FakeFetch(),
        debug:      { bound: () => () => {} },
    };
    return fplus;
}
