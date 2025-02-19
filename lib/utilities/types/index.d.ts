/*
 * Factory+ NodeJS Utilities
 * Type Declaration File.
 * Copyright 2023 AMRC.
 */
import * as sparkplugbpayload from './lib/sparkplugpayload';
import {PathLike, PathOrFileDescriptor} from "fs";
import {GotFetchResponse} from "got-fetch/out/lib/response";

export * from "./db";
export * from "./debug";
export * from "./service-client"
export * from "./sparkplug/util"
export * from "./webapi"

export * from "./service/auth";
export * from "./service/configdb";
export * from "./service/discovery";
export * from "./service/fetch";
export * from "./service/mqtt";

export const Version: string;
/**
 * UUIDs
 */

export namespace UUIDs {
    export const FactoryPlus: string;
    export const Null: string;

    /**
     * UUIDs of F+ Core Services 
     */
    export const App: {
        Registration: string,
        Info: string,
        SparkplugAddress: string
    };

    /**
     * UUIDs of F+ Default Classes
     */
    export const Class: {
        Class: string,
        Device: string,
        Schema: string,
        App: string,
        Service: string
    }

    /**
     * UUIDs of F+ Default Schemas
     */
    export const Schema: {
        Device_Information: string,
        Service: string
    }

    /**
     * Common UUIDs of F+ Services
     */
    export const Service: {
        Directory: string,
        Registry: string,
        Authentication: string,
        Command_Escalation: string,
        MQTT: string
    }
}

/**
 * dependencies
 */

export const GSS: any;
export const Pg: any;
export function fetch(url: any, opts: any): Promise<GotFetchResponse>;

/**
 * secrets
 */
export function read(name: string): Buffer | null;
export function readUTF8(name: string): string | null;
export function env(key: string): string | null;

/**
 * Util
 */

export const SpB: typeof sparkplugbpayload | null;
export function resolve(meta: ImportMeta, file: string): string;
export function pkgVersion(meta: ImportMeta): string;
export function loadJsonObj(file: PathOrFileDescriptor): object;
export function loadAllJson(files: PathLike[]): [path: string, obj: object][];

