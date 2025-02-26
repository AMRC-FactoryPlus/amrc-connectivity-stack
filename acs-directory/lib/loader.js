/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * Dump loading endpoints
 * Copyright 2025 AMRC
 */

export class Loader {
    constructor (opts) {
        this.model = opts.model;
        this.fplus = opts.fplus;
        this.routes = this.load.bind(this);
    }

    async load(req, res) {
        if(req.auth !== this.fplus.opts.root_principal){
            res.status(401).end();
        }

        try{
            const info = await this.model.dump_load(req);
            res.status(info).end();
        }catch (e) {
            console.log(e);
            res.status(500).json({error: e.message});
        }
    }
}