/*
 * Factory+ NodeJS Utilities
 * Data Access service interface.
 */
import { writeFile } from 'fs/promises';

import { Service } from "../uuids.js";
import { ServiceInterface } from "./service-interface.js";

/** Interface to the Data Access service
 * 
 * 
 */

export class DataAccess extends ServiceInterface{
    constructor(fplus){
        super(fplus);
        this.service = Service.DataAccess;
        this.log = fplus.debug.bound("data-access");
    }

    /** 
     * Returns list of dataset uuids with READ_DATASET permission. 
     */
    async get_readable_dataset_uuids(){
        const [st, json] = await this.fetch('v1/metadata');
        if(st === 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`);
        if(st !== 200)
            this.throw(`Can't get dataset uuids ${st} ${json}`);
        return json;
    }


    /**
     * Returns json object with dataset metadata
     */
    async get_dataset_metadata(uuid){
        const [st, json] = await this.fetch(`v1/metadata/${uuid}`);
        if(st == 404) return {};
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`);
        if(st != 200)
            this.throw(`Can't get metadata for dataset ${uuid}\n ${st} ${json}`);
        return json;
    }
    
    /**
     * Download data in csv format
     */
    async download_data(uuid) {
        const [st, csv] = await this.fetch({
            url: `v1/data/${uuid}`, 
            method: 'POST',
        });

        if (st === 404) return "Not Found";
        if (st === 403)
            throw new Error(`Unauthorised to access dataset ${uuid}`);
        if (st != 200)
            throw new Error(`Can't download data for dataset ${uuid} ${res.status}`);

        
        // const buffer = Buffer.from(await res.arrayBuffer());

        // // filename (optional)
        // const disposition = res.headers.get('content-disposition');
        // let filename = `${uuid}.csv`;
        // if (disposition?.includes('filename=')) {
        //     filename = disposition.split('filename=')[1];
        // }

        // await writeFile(filename, buffer);

        // return filename;
    }


    async get_editable_dataset_uuids(){
        const [st, json] = await this.fetch('v1/structure');
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`);
        if(st != 200)
            this.throw(`Can't get dataset uuids ${st} ${json}`);
        return json;
    }

    /**
     * 
     * @param {*} structure is one of the Dataset Definition app uuids src, session or union.   
     * @param {*} config is the config entry content of dataset
     */
    async create_dataset(structure, config){
        const [st, json] = await this.fetch({
            url:'v1/structure',
            method: 'POST',
            body: {
                structure,
                config
            }
        });

        if(st == 404) return "";
        if(st == 403)
            this.throw(`Unauthorised to create dataset`);
        if(st != 200)
            this.throw(`Can't create dataset ${st} ${json}`);
        return json;
    }



    /**
     * Returns dataset definition (content of the config entry)
     */

    async get_dataset_definition(uuid){
        const [st, json] = await this.fetch(`v1/structure/${uuid}`);
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`);
        if(st != 200)
            this.throw(`Can't get dataset definition ${st} ${json}`);
        return json;
    }


    async update_dataset_definition(uuid, structure, config){
        const [st, json] = await this.fetch({
            url: `v1/structure/${uuid}`,
            method: 'PUT',
            body: {
                structure,
                config
            }
        });
        if(st == 404) return [];
        if(st == 403)
            this.throw(`Unauthorised to update dataset ${uuid}`);
        if(st != 200)
            this.throw(`Can't update dataset definition ${st} ${json}`);
        return json;
    }
}