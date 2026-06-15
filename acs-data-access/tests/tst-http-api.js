

import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";


/**
 * This is a test script that uses rx-client DataAccess client interface
 * to subscribe to DataAccess Notify API. 
 */


    // .get_metadata_list();
    // .get_single_metadata(DATASET_UUID)
async function main(){
    const fplus = new ServiceClient({
        directory_url: process.env.DIRECTORY_URL,
        username: process.env.HUMAN_USERNAME,
        password: process.env.HUMAN_PASSWORD,
        verbose: 'ALL'
    });


    const uuid = "e2a4c530-dc0f-417d-b00b-329b0e90e033";
    // const res = await fplus.DataAccess.delete_dataset(uuid);




    const res = await fplus.DataAccess.download_data(uuid);

    // const res = await fplus.DataAccess.get_metadata_list();

    console.log("Test Data Access HTTP");
    console.log(res);
    console.log("");
}


main().catch(console.error);