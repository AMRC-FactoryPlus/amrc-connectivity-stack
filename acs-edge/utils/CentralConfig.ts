/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import Ajv from "ajv";
import {readFileSync, writeFileSync} from "fs";
import {log} from "../lib/helpers/log.js";
import addFormats from "ajv-formats";
import * as dotenv from 'dotenv';

dotenv.config({path: '../../.env'});

const schema = JSON.parse(readFileSync("./schema/schema.json").toString());
const ajv = new Ajv({allErrors: false, strictTypes: false});
addFormats(ajv);
ajv.addVocabulary(["options", "headerTemplate", "links"]);
const validate = ajv.compile(schema);

/**
 * Validates data from the API request against the config schema
 * @param ApiData Data returned from the Api request
 * @returns boolean
 */
export function validateConfig (apiData: object): boolean {
    if (validate(apiData)) {
        return true;
    } else {
        log(`Errors: ${ajv.errorsText(validate.errors)}`);
        return false;
    }
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
