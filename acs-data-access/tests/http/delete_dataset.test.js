import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import * as Temp_Data from '../temp_data.js';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /delete/:uuid', () => {
    const TEST_PRINCIPAL=process.env.TEST_HUMAN_UUID;

    let test_fplus; 
    let admin_fplus;
    let ALL_GRANTS = [];


    beforeEach(async () => {
        admin_fplus = new ServiceClient({
            directory_url: process.env.DIRECTORY_URL,
            username: process.env.ADMIN_USERNAME,
            password: process.env.ADMIN_PASSWORD,
            verbose: 'ALL'
        });

        test_fplus = new ServiceClient({
            directory_url: process.env.DIRECTORY_URL,
            username: process.env.TEST_HUMAN_USERNAME,
            password: process.env.TEST_HUMAN_PASSWORD,
            verbose: 'ALL'
        });

        await sleep(2000); 
    });

    beforeAll( async () => {
        admin_fplus = new ServiceClient({
            directory_url: process.env.DIRECTORY_URL,
            username: process.env.ADMIN_USERNAME,
            password: process.env.ADMIN_PASSWORD,
            verbose: 'ALL'
        });
    });

    // Clean up grants if not removed in case of failure.
    afterAll(async () => {
        for (let grant of ALL_GRANTS){
            await deleteGrant(grant);
        }
    });


    async function addGrant(principal, permission, target, plural){
        if(!principal ||
            !permission ||
            !target
        ) return;

        const grant_uuid = await admin_fplus.Auth.add_grant({
            principal,
            permission,
            target,
            plural
        });
        ALL_GRANTS.push(grant_uuid);
        return grant_uuid;
    }

    async function deleteGrant(grant_uuid){
        if(!grant_uuid) return;

        await admin_fplus.Auth.delete_grant(grant_uuid)
        ALL_GRANTS = ALL_GRANTS.filter(uuid => uuid !== grant_uuid);
    }


    test('Successful deletion', async () => {
        const dataset_uuid = await admin_fplus.DataAccess.create_dataset(Constants.App.SparkplugSrc, Temp_Data.Valid_Body.SRC.config);

        await sleep(4000);

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.DeleteDataset,
            dataset_uuid, 
            false
        );

        await sleep(4000);

        const deleted = await test_fplus.DataAccess.delete_dataset(dataset_uuid);
        
        await sleep(4000);

        await deleteGrant(grant);

        expect(deleted).toBe(dataset_uuid);

    }, 30000);

    test('Irrelevant permission', async () => {
        const dataset_to_be_deleted = Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset;
        
        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            dataset_to_be_deleted,
            false
        );

        await sleep(3000);

        try {
            await test_fplus.DataAccess.delete_dataset(dataset_to_be_deleted);

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }

        await deleteGrant(grant);
        
    }, 30000);

    test('Invalid uuid', async () => {

        try {
            await test_fplus.DataAccess.delete_dataset("xxx");

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(422); 
        }
    }, 30000);
});