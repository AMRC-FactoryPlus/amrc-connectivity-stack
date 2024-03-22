import fsp from "fs/promises";
import process from "process";
import {load_yaml} from "../lib/dumps.js";

const files = await fsp.readdir("dumps");
let exit = 0;
for (const f of files) {
    if (!f.endsWith(".yaml"))
        continue;
    try { 
        await load_yaml(f);
    } 
    catch (e) {
        exit = 1;
        console.error("===> %s:\n\n%s", e.message, 
            e.cause.map(c => c.toString()).join("\n"));
    }
}

process.exit(exit);
