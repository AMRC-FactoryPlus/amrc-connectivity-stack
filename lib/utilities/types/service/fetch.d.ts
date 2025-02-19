import {ServiceClient, ServiceInterface} from "../service-client";

export default class Fetch extends ServiceInterface {
    constructor(fplus: ServiceClient);
    tokens: Map<any, any>;
    inflight: Map<any, any>;

    /**
     * Discover an HTTP URL for a service and make an HTTP request
     * @param opts Fetch Options
     */
    fetch(opts: fetchQuery & RequestInit): Promise<any>;
}

export interface fetchQuery {
    /**
     * Service UUID to be queried from
     */
    service: string;

    /**
     * URL endpoint to query from service.
     */
    url: string;

    /**
     * Desired query. Can be any Object
     */
    query?: { [s: string]: any } | ArrayLike<any>;
}