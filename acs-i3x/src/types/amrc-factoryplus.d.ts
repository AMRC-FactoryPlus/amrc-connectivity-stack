declare module "dotenv" {
    export function config(opts?: any): void;
}

declare module "@amrc-factoryplus/service-client" {
    export class ServiceClient {
        constructor(opts: any);
        init(): Promise<this>;
        ConfigDB: any;
        Directory: any;
        Auth: any;
        MQTT: any;
        debug: any;
        mqtt_client(opts?: any): Promise<any>;
        service_urls(uuid: string): any;
    }
    export const UUIDs: any;
    export const SpB: any;
    export const GSS: any;
    export const MQTT: any;
}

declare module "@amrc-factoryplus/service-api" {
    export class WebAPI {
        constructor(opts: any);
        init(): Promise<this>;
        run(): void;
        app: any;
        http: any;
    }
    export class APIError extends Error {
        status: number;
        constructor(status: number);
    }
    export class FplusHttpAuth {
        constructor(opts: any);
        setup(app: any): void;
    }
}
