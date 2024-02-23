export default class Icons {
    constructor () {
        this.fetching = new Set();
        this.icons = new Map();
    }

    request_icon (uuid) {
        if (this.fetching.has(uuid)) {
            console.log("Skipping fetch for %s", uuid);
            return;
        }
        this.fetching.add(uuid);

        const url = `/schema/${uuid}.svg`;
        console.log("Fetching icon %s", url);
        const icon = new Image();
        icon.onload = () => {
            const aspect = icon.naturalHeight && icon.naturalWidth
                ? icon.naturalWidth / icon.naturalHeight
                : 1;
            console.log("Loaded %s for %s (%s)", url, uuid, aspect);
            this.icons.set(uuid, { icon, aspect });
        };
        icon.src = url;
    }

    fetch_icon (uuid) {
        return this.icons.get(uuid);
    }
}
