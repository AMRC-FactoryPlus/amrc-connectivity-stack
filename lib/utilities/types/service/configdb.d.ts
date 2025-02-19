import {ServiceClient, ServiceInterface} from "../service-client";

interface ConfigDBSearch {
    app: string;
    query: object;
}

interface ConfigDBMappedSearch {
    app: string;
    query: object;
    results: object;
}

/**
 * ConfigDB service interface.
 */
export default class ConfigDB extends ServiceInterface {
    constructor(fplus: ServiceClient);

    get_config (app: string, obj: string): Promise<any>;
    get_config_with_etag (app: string, obj: string)
        : Promise<[any, string | undefined]>;
    get_config_etag (app: string, obj: string)
        : Promise<string | undefined>;
    
    put_config (app: string, obj: string, json: any): Promise<void>;
    delete_config (app: string, obj: string): Promise<void>;
    patch_config (app: string, obj: string, type: string, patch: any)
        : Promise<void>;
    list_configs (app: string): Promise<string[] | undefined>;

    create_object (klass: string, obj?: string, excl?: boolean)
        : Promise<string>;
    delete_object (obj: string): Promise<void>;

    search (opts: ConfigDBSearch): Promise<string[]>;
    search (opts: ConfigDBMappedSearch): Promise<object>;
    search (app: string, query: object): Promise<string[]>;
    search (app: string, query: object, results: object): Promise<object>;

    resolve (opts: ConfigDBSearch): Promise<string | undefined>;

    /* This is not exposed to TS at the moment. I don't want to give
     * this library a required dep on rxjs; the code loads
     * ConfigDBWatcher dynamically to avoid this. But I don't know if I
     * can declare the types without such a dependency. */
    //watcher (): Promise<ConfigDBWatcher>;
}
