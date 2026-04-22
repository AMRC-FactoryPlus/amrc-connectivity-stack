/*
 * Factory+ NodeJS Utilities
 * Data Access service interface.
 */
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
    async get_dataset_uuids(){
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
    async download_data(uuid){
        const [st, json] = await this.fetch({
            url: `data/${uuid}`,
            method: 'POST', 
        });

        if(st == 404) return "Not Found";
        if(st == 403)
            this.throw(`Unauthorised to access dataset ${uuid}`);
        if(st != 200)
            this.throw(`Can't download data for dataset ${uuid}\n ${st} ${json}`);

        return json;
    }
}