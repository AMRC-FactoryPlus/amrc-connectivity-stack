import {
    DEVICE_INFORMATION_APP_UUID,
    DEVICE_CLASS_UUID,
    INFO_APP_UUID,
    CONFIG_SCHEMA_APP_UUID
} from "./constants.js";
import {ObjectTree} from "./object-tree.js";
import {I3xRag} from "./rag/i3x-rag.js";
import * as rx from "rxjs";


export interface RefreshOpts {
    fplus: any,
    objectTree: ObjectTree,
    i3xRag: I3xRag
}

export class ObjectTreeRefresh {
    private fplus: any;
    private objectTree: ObjectTree;
    private i3xRag: I3xRag;
    private log: (msg: string, ...args: any[]) => void;


    constructor(opts: RefreshOpts) {
        this.fplus = opts.fplus;
        this.objectTree = opts.objectTree;
        this.i3xRag = opts.i3xRag;
        this.log = opts.fplus.debug.bound("refresh");
    }

    async run(){
        // A `dirty` flag coalesces events that arrive during an in-flight refresh, so a
        // burst of changes collapses into at most two rebuilds (leading + trailing).
        const cdb = this.fplus.ConfigDB;
        const trigger$ = rx.merge(
            cdb.watch_members(DEVICE_CLASS_UUID),
            cdb.search_app(DEVICE_INFORMATION_APP_UUID, {}),
            cdb.search_app(INFO_APP_UUID, {}),
            cdb.search_app(CONFIG_SCHEMA_APP_UUID, {}),
        );
        let inFlight = false;
        let dirty = false;
        const runRefresh = async () => {
            inFlight = true;
            try {
                do {
                    dirty = false;
                    await this.objectTree.refresh();
                    this.i3xRag.rebuild();
                    this.log("object tree refreshed: nodes=%d", this.i3xRag.nodeCount());
                } while (dirty);
            } catch (err) {
                console.error("Failed to refresh object tree:", err);
            } finally {
                inFlight = false;
            }
        };
        trigger$.subscribe({
            next: () => {
                if (inFlight) { dirty = true; return; }
                void runRefresh();},
            error: (err: unknown) => console.error("ConfigDB notify stream errored:", err),
        });
        this.log("ConfigDB notify subscriptions active");
    }
}