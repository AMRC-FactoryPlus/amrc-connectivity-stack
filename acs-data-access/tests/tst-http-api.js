

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
        username: process.env.TEST_HUMAN_USERNAME,
        password: process.env.TEST_HUMAN_PASSWORD,
        verbose: 'ALL'
    });


    const uuid = "a7594958-4b03-45e4-8ac0-4af8d1e77e3f";
    const res = await fplus.DataAccess.delete_dataset(uuid);




    // const res = await fplus.DataAccess.download_data(DATASET_UUID)

    // const res = await fplus.DataAccess.get_metadata_list();

    console.log("Test Data Access HTTP");
    console.log(res);
    console.log("");
}


main().catch(console.error);