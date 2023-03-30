/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import axios, {AxiosError} from "axios";
import Ajv from "ajv";
import {readFileSync, writeFileSync} from "fs";
import {log} from "../lib/helpers/log.js";
import addFormats from "ajv-formats";
import * as dotenv from 'dotenv';
import * as secrets from "../lib/k8sSecrets.js";

dotenv.config({path: '../../.env'});

const schema = JSON.parse(readFileSync("./schema/schema.json").toString());

/**
 * Validates data from the API request against the config schema
 * @param ApiData Data returned from the Api request
 * @returns boolean
 */
let validate = (apiData: object): boolean => {
    const ajv = new Ajv({allErrors: false, strictTypes: false});
    addFormats(ajv);
    ajv.addVocabulary(["options", "headerTemplate", "links"]);
    const validate = ajv.compile(schema);
    if (validate(apiData)) {
        return true;
    } else {
        log(`Errors: ${ajv.errorsText(validate.errors)}`);
        return false;
    }
}

/**
 * Makes and Axios GET to config url endpoint
 * @returns valid config
 */
export async function ConfigPOST(): Promise<object> {
    // @ts-ignore
    return await axios.post(process.env.CONFIG_URL, {
        node_id: process.env.NODE_ID,
        config_password: secrets.env({key: 'keytab'})
    })
        .then(response => {
            let formattedData = JSON.parse(response.data.data);
            if (validate(formattedData)) {
                return formattedData;
            } else {
                return null;
            }
        })
        .catch(err => {
            if (axios.isAxiosError(err)) {
                if (err.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    log(err.response.data.message);
                    log(JSON.stringify(err.response.status));
                } else {
                    // Something happened in setting up the request that triggered an Error
                    log(err.message);
                }
            } else {
                log(err as string);
            }
        });
}

/**
 * Polls the config api endpoint for new, valid config and writes to config file
 * @returns valid config or null
 */
export async function fetchConfig(): Promise<any> {
    return await ConfigPOST()
        .then(data => {
            if (data) {
                return data;
            } else {
                return null;
            }
        })
        .catch(err => {
            log(err);
        });
}

/**
 * Resolves promise after s seconds
 * @param s seconds to wait
 * @returns promise
 */
export async function wait(s: number): Promise<Function> {
    return new Promise(resolve => {
        setTimeout(resolve, s * 1000);
    })
}