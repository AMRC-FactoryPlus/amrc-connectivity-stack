import fsp from "fs/promises";
import process from "process";
import { DumpLoader } from "../lib/dumps.js";

const dumps = new DumpLoader({
    dumps:      "dumps",
    acs_config: {
        namespace:      "factory-plus",
        url_protocol:   "https",
        base_url:       "my.domain",
    },
});

/* XXX For now this can't use the for_all_dumps as we want to continue
 * on parse errors. */
let exit = 0;
const files = await fsp.readdir(dumps.dumps);
for (const f of files) {
    if (!f.endsWith(".yaml"))
        continue;
    try { 
        await dumps.load_yaml(f);
    } 
    catch (e) {
        exit = 1;
        console.error("===> %s:\n\n%s", e.message, 
            e.cause.map(c => c.toString()).join("\n"));
    }
}

process.exit(exit);
