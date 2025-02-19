import {Debug} from "./debug";

import Auth from "./service/auth";
import ConfigDB from "./service/configdb";
import Discovery from "./service/discovery";
import Fetch from "./service/fetch";
import MQTTInterface from "./service/mqtt";


interface ServiceClient extends Auth, Fetch, Discovery, MQTTInterface {

}

export class ServiceClient {
    constructor(config?: ServiceClientConfig);

    /**
     * Debug Object.
     */
    debug: Debug;

    /**
     * Fetches JSON Object from Config DB
     * @param app App uuid
     * @param obj Object uuid
     */
    fetch_configdb(app: string, obj: string): Promise<object>;

    /**
     * Initialisation Function.
     * Has no uses currently.
     */
    init(): Promise<ServiceClient>;

    Auth: Auth;
    ConfigDB: ConfigDB;
    Discovery: Discovery;
    Fetch: Fetch;
    MQTT: MQTTInterface;
}

/**
 * Based class for Service Interfaces
 */
export class ServiceInterface {
    constructor(fplus: ServiceClient);

    fplus: ServiceClient;
    debug: Debug;
}

/**
 * Interface object to be ingested by Service Client
 */
export interface InterfaceDefinition {
    name: string;
    klass: ServiceInterface;
    methodList: string;
}

export interface ServiceClientConfig {
    /** Supply process.env to pull from the environment */
    env?: { [index: string]: string | undefined };
    /**
     * Username for basic authentication
     */
    username?: string;
    /**
     * Password for basic authentication
     */
    password?: string;
    /**
     * 	Kerberos principal which overrides permission checks.
     */
    root_principal?: string;
    /**
     * Permission group for ACL checks.
     */
    permission_group?: string;
    /**
     * 	URL to the Directory.
     */
    directory_url?: string;

    /**
     * URL to Authentication
     */
    authn_url?: string;
}
