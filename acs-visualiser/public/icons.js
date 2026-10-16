const SchemaIcon = "65c0ccba-151d-48d3-97b4-d0026a811900";
const RETRY_DELAY = 30000;

export default class Icons {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.fetching = new Set();
        this.icons = new Map();
    }

    async init () { return this; }

    async request_icon (uuid) {
        if (uuid == undefined) return;
        if (this.fetching.has(uuid)) {
            //console.log("Skipping fetch for %s", uuid);
            return;
        }
        this.fetching.add(uuid);

        let icon;
        try {
            icon = await this.cdb.get_config(SchemaIcon, uuid);
        }
        catch (e) {
            /* Each schema is only requested once, so a failure left in
             * place would lose its icon on this screen for good. */
            console.log(`Can't fetch icon for ${uuid}, retrying: ${e}`);
            setTimeout(() => {
                this.fetching.delete(uuid);
                this.request_icon(uuid);
            }, RETRY_DELAY);
            return;
        }
        if (icon == undefined) return;

        const { bbox } = icon;
        this.icons.set(uuid, {
            path:   new Path2D(icon.path),
            scale:  1 / Math.max(bbox.width, bbox.height),
            offset: [-(bbox.width/2)-bbox.left, -(bbox.height/2)-bbox.top],
        });
    }

    fetch_icon (uuid) {
        if (uuid == undefined) return;
        return this.icons.get(uuid);
    }
}
