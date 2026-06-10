import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import * as Temp_Data from '../temp_data.js';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /structure/:uuid', () => {
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
        await sleep(1000); 
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

    async function deleteDataset(uuid){
        if(!uuid) return;

        await admin_fplus.DataAccess.delete_dataset(uuid);
    }

    async function addConfig(app, obj, config){
        if(!app ||
            !obj || 
            !config
        ) return;

        await admin_fplus.ConfigDB.put_config( app, obj, config );
    }

    async function removeConfig(app, obj){
        if(!app || !obj) return;

        await admin_fplus.ConfigDB.delete_config( app, obj );
    }

    test('Dataset exist but no permission', async () => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.TestDeviceDataset;

        try {
            const res = await test_fplus.DataAccess.get_single_structure(testCase);
            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).not.toBe(200); 
        }
    });

    test('User has irrelevant permission to the dataset', async () => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.TestDeviceDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            testCase,
            false
        );

        try {
            const res = await test_fplus.DataAccess.get_single_structure(testCase);
            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).not.toBe(200); 
        }
        finally{
            await deleteGrant(grant);
        }
    });

    test('Invalid uuid', async () => {
        const testCase = 'xxx';

        try {
            const res = await test_fplus.DataAccess.get_single_structure(testCase);
            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).not.toBe(200); 
        }
    });


    test('Invalid dataset -> Special UUID', async () => {
        const testCase = Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset;
        const invalidApp = Constants.App.UnionComponents;

        // Grant
        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            testCase,
            false
        );

        await sleep(3600);


        // make testCase invalid
        await addConfig(
            invalidApp,
            testCase,
            []
        );
        await sleep(3600);


        const res_invalid = await test_fplus.DataAccess.get_single_structure(testCase);
        await sleep(1000);
 


        await removeConfig(invalidApp, testCase);        
        await deleteGrant(grant);


        expect(res_invalid.structure).toEqual(Constants.Special.InvalidDataset);
        expect(res_invalid.config).toBe(null);

    }, 40000);

    test('SRC', async () => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset;


        // Grant
        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            testCase,
            false
        );

        await sleep(3600);

        const res = await test_fplus.DataAccess.get_single_structure(testCase);
        console.log(res);

    
        await deleteGrant(grant);

        expect(res.structure).toEqual(Constants.App.SparkplugSrc);
        expect(res.config).not.toBe(null);
        expect(res.config).toHaveProperty('source');
    }, 40000);

});