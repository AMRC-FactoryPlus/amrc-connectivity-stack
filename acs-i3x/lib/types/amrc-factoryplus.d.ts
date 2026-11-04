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

    /* The shared ISA-95 rule (lib/js-service-client/lib/isa95.js). */
    export const ISA95_LEVELS: readonly string[];
    export interface Isa95VocabNode {
        uuid: string;
        name: string;
        level?: string;
        aliases: string[];
        children: string[];
    }
    export interface Isa95VocabIndex {
        nodes: Map<string, Isa95VocabNode>;
        parents: Map<string, string[]>;
    }
    export function isa95_vocabulary(nodes: Iterable<Isa95VocabNode>): Isa95VocabIndex;
    export function isa95_chain(vocab: Isa95VocabIndex, node: string):
        { chain: Isa95VocabNode[]; error?: undefined } | { chain?: undefined; error: string };
    export function isa95_value_problem(value: string): string | null;
}

declare module "@amrc-factoryplus/rx-client" {
    export class RxClient {
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
    export const NotifyV2: any;
    export const Interfaces: any;
}

declare module "@amrc-factoryplus/rx-util" {
    export function cacheSeq(opts: any): (arg: any) => any;
    export function shareLatest(...args: any[]): any;
    export const Response: any;
    export function rx(...args: any[]): any;
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
