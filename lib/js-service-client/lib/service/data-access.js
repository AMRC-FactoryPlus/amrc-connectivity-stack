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

    /** Returns list of dataset uuids with read dataset permission. 
     * 
     */
    async get_dataset_uuids(){
        const [st, json,] = await this.fetch('v1/metadata');
        if(st === 404) return [];
        if(st !== 200)
            this.throw(`Can't get dataset uuids ${st} ${json}`);
        return [json];
    }
}