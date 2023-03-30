/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

const fs = require('fs');
require('dotenv').config();
export class Config {
    constructor() {
        this.conf = null;
        this.read();
    }
    read() {
        this.conf = JSON.parse(fs.readFileSync("./config/conf.json"));
    }
    write(conf) {
        fs.writeFile("./config/conf.json", JSON.stringify(conf));
        this.conf = conf;
    }
    update(key, value) {
        this.conf[key] = value;
        this.write(this.conf);
    }
}
//# sourceMappingURL=config.js.map