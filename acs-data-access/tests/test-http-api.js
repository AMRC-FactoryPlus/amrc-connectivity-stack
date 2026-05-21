

import {ServiceClient} from "@amrc-factoryplus/service-client";
import * as rx from "rxjs";
import readline from "node:readline";
import process from "node:process";


/**
 * This is a test script that uses rx-client DataAccess client interface
 * to subscribe to DataAccess Notify API. 
 */
async function main(){
    const fplus = new ServiceClient({
        directory_url: process.env.DIRECTORY_URL,
        username: process.env.HUMAN_USERNAME,
        password: process.env.HUMAN_PASSWORD,
        verbose: 'ALL'
    });

    const DATASET_UUID = "";

    const res = await fplus.DataAccess
    // .get_metadata_list();
    // .get_single_metadata(DATASET_UUID)
    .download_data(DATASET_UUID)

    console.log("Test Data Access HTTP");
    console.log(res);
    console.log("");
}


main()