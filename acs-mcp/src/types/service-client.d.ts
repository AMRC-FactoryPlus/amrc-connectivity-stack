/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Type declarations for @amrc-factoryplus/service-client
 * This module is written in JavaScript without type declarations.
 */

declare module "@amrc-factoryplus/service-client" {
    export interface ServiceClientOptions {
        env?: NodeJS.ProcessEnv;
        directory_url?: string;
        username?: string;
        password?: string;
        verbose?: boolean;
        browser?: boolean;
    }

    export interface ConfigDB {
        get_config(app: string, obj: string): Promise<any>;
        get_config_with_etag(app: string, obj: string): Promise<[any, string] | []>;
        put_config(app: string, obj: string, json: any): Promise<void>;
        delete_config(app: string, obj: string): Promise<void>;
        patch_config(app: string, obj: string, type: string, patch: any): Promise<void>;
        list_configs(app: string): Promise<string[] | undefined>;
        get_all_configs(app: string): Promise<Map<string, any>>;
        create_object(klass: string, obj?: string, excl?: boolean): Promise<string>;
        delete_object(obj: string): Promise<void>;
        mark_object_deleted(obj: string): Promise<void>;
        class_members(klass: string): Promise<string[]>;
        class_subclasses(klass: string): Promise<string[]>;
        class_direct_members(klass: string): Promise<string[]>;
        class_direct_subclasses(klass: string): Promise<string[]>;
        class_has_member(klass: string, obj: string): Promise<boolean>;
        class_has_subclass(klass: string, obj: string): Promise<boolean>;
        class_add_member(klass: string, obj: string): Promise<void>;
        class_remove_member(klass: string, obj: string): Promise<void>;
        class_add_subclass(klass: string, obj: string): Promise<void>;
        class_remove_subclass(klass: string, obj: string): Promise<void>;
        search(opts: {
            app: string;
            query: Record<string, unknown>;
            klass?: string;
            results?: Record<string, string>;
        }): Promise<string[] | Record<string, unknown>[]>;
        resolve(opts: {
            app: string;
            query: Record<string, unknown>;
            klass?: string;
        }): Promise<string | undefined>;
    }

    export interface Auth {
        resolve_principal(query: any): Promise<string | undefined>;
        find_principal(kind?: string, identifier?: string): Promise<any>;
        list_principals(): Promise<string[]>;
        check_acl(principal: any, permission: string, target: string, wild?: boolean): Promise<boolean>;
        whoami(): Promise<any>;
        whoami_uuid(): Promise<string>;
        list_grants(): Promise<string[]>;
        get_grant(uuid: string): Promise<any>;
        get_all_grants(): Promise<any[]>;
        find_grants(pattern: Record<string, string>): Promise<string[]>;
        get_identity(uuid: string, kind: string): Promise<string>;
    }

    export interface Directory {
        get_service_info(service: string): Promise<{ url?: string; device?: string } | undefined>;
        get_service_url(service: string): Promise<string | undefined>;
        get_device_info(device: string): Promise<{
            uuid: string;
            group_id: string;
            node_id: string;
            device_id?: string;
            online: boolean;
            last_change?: number;
            top_schema?: string;
            schemas?: string[];
        } | undefined>;
        get_device_address(device: string): Promise<{ toString(): string } | undefined>;
    }

    export class ServiceClient {
        constructor(opts?: ServiceClientOptions);
        init(): Promise<ServiceClient>;
        readonly ConfigDB: ConfigDB;
        readonly Auth: Auth;
        readonly Directory: Directory;
        service_urls(uuid: string): Promise<string[]>;
        fetch(opts: any): Promise<Response>;
    }
}
