

import {RxClient} from "@amrc-factoryplus/rx-client";
import * as rxu from "@amrc-factoryplus/rx-util";
import * as rx from "rxjs";
import readline from "node:readline";
import process from "node:process";


/**
 * This is a test script that uses rx-client DataAccess client interface
 * to subscribe to DataAccess Notify API. 
 */
async function main(){
    const fplus = new RxClient({
        directory_url: process.env.DIRECTORY_URL,
        username: process.env.HUMAN_USERNAME,
        password: process.env.HUMAN_PASSWORD,
        verbose: 'ALL'
    });

    const DATASET_UUID = "";

    const subscription = fplus.DataAccess
    // .watch_metadata_list()
    // .watch_single_metadata(DATASET_UUID)
    // .search_metadata()
    // .watch_structure_list()
    // .watch_single_structure(DATASET_UUID)
    .search_structure()
        .subscribe({
            next: value => {
                console.log("TEST: UPDATE from DataAccess");
                console.log(value?.toJS());
                console.log("");
            },

            error: err => {
                console.error("ERROR");
                console.error(err);
            },

            complete: () => {
                console.log("COMPLETE");
            },
        });

    // ----------------------------------------
    // Keep process alive + quit on q
    // ----------------------------------------
    readline.emitKeypressEvents(process.stdin);

    if(process.stdin.isTTY)
        process.stdin.setRawMode(true);

    console.log("Press q to quit");

    process.stdin.on("keypress", (_, key) => {
        if(key.name === "q"){
            console.log("\nQuitting");
            subscription.unsubscribe();
            process.exit(0);
        }
    });
}


main().catch(err => {
    console.error(err);
    process.exit(1);
})