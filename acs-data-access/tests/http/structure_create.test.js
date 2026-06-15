import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import * as Temp_Data from '../temp_data.js';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('POST /structure', () => {
    const TEST_PRINCIPAL=process.env.TEST_HUMAN_UUID;

    let test_fplus; 
    let admin_fplus;
    let ALL_GRANTS = [];

    const ALL_INVALID_BODY_CASES = [
        ...Temp_Data.Invalid_Body_Structure,
        ...Temp_Data.Invalid_Body_Config.SRC,
        ...Temp_Data.Invalid_Body_Config.Session,
        ...Temp_Data.Invalid_Body_Config.Union,
    ];

    const ALL_VALID_BODY_CASES = [
        Temp_Data.Valid_Body.SRC,
        Temp_Data.Valid_Body.Session,
        Temp_Data.Valid_Body.Union
    ];

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



    test('No permission', async () => {
        try {
            await test_fplus.DataAccess.create_dataset(
                Temp_Data.Valid_Body.SRC.structure,
                Temp_Data.Valid_Body.SRC.config
            );

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }
    });

    test('Correct permission for irrelevant structure', async () => {
        const irrelevant_structure = Constants.App.SessionLimits;

        const irrelevant_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.CreateDataset,
            irrelevant_structure,
            false
        );
        await sleep(4000);

        try {
            await test_fplus.DataAccess.create_dataset(
                Temp_Data.Valid_Body.Session.structure,
                Temp_Data.Valid_Body.Session.config
            );

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }

        await deleteGrant(irrelevant_grant);
    });



    test.each(ALL_INVALID_BODY_CASES)('Invalid body cases - case %#', async (testCase) => {
        try {

            await test_fplus.DataAccess.create_dataset(testCase.structure, testCase.config);
            expect.fail('Expected to throw');

        } catch (err) {

            expect(err.status).toBe(422);
        }
    });

    test.each(ALL_VALID_BODY_CASES)('Missing 2nd level permission cases - case %#', async (testCase) => {
        try{
            // Add 1st level grant
            
            const grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.CreateDataset,
                testCase.structure,
                false
            );

            await test_fplus.DataAccess.create_dataset(testCase.structure, testCase.config);

            
            expect.fail('Expected create_dataset to throw');

            // Revoke 1st level grant
            await deleteGrant(grant);
        } catch(err){
            console.log(err);
            expect(err.status).toBe(403);
        }
    });


    test.each(ALL_VALID_BODY_CASES)('Successful create - case %#', async (testCase) => {
        
        let grants = [];
        
        // add 1st level grant
        const grant_uuid = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.CreateDataset,
            testCase.structure,
            false
        );
        grants.push(grant_uuid);

        await sleep(4000);


        if(testCase.structure === Constants.App.UnionComponents){
            for(let src of testCase.config){
                const g = await addGrant(
                    TEST_PRINCIPAL,
                    testCase.secondLevelPerm,
                    src,
                    false
                );
                grants.push(g);
                await sleep(1000);
            }
        }else{
            const g = await addGrant(
                        TEST_PRINCIPAL,
                        testCase.secondLevelPerm,
                        testCase.config.source,
                        false
                    );
            grants.push(g);
        }
        await sleep(4000);

        const dataset_uuid = await test_fplus.DataAccess.create_dataset(
                testCase.structure,
                testCase.config
        );
        await sleep(2000);
        
        for(let grant of grants){
            await deleteGrant(grant);
        }
        await deleteDataset(dataset_uuid);

        expect(dataset_uuid).not.toBe(undefined);
    }, 30000);


    // /* =============================================== */
    // /* -------- Test subclass relationships ---------- */
    // /* =============================================== */
    test('Session dataset becomes subclass of its source dataset', async () => {
        const testCase = Temp_Data.Valid_Body.Session;
        // 1. grants: CreateDataset and IncludeInSession for src
        let grants = [];
    
        const create_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.CreateDataset,
            testCase.structure,
            false
        );
        grants.push(create_grant);

        await sleep(4000);

        const scnd_lvl_grant = await addGrant(
            TEST_PRINCIPAL, 
            testCase.secondLevelPerm,
            testCase.config.source,
            false
        );

        grants.push(scnd_lvl_grant);
        await sleep(4000);

        // 2. dataset_uuid = create session dataset 
        const dataset_uuid = await test_fplus.DataAccess.create_dataset(testCase.structure, testCase.config);
        await sleep(2000);

        // 3. query the source's subclasses
        const subclasses = await admin_fplus.ConfigDB.class_subclasses(testCase.config.source);

        // 4. revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }

        // 5. Delete dataset
        await deleteDataset(dataset_uuid);


        // 6. assert source's subclasses include new dataset_uuid
        expect(subclasses).toContainEqual(dataset_uuid);
    }, 30000);

    test('Union dataset becomes superclass of its sources ', async () => {
        const testCase = Temp_Data.Valid_Body.Union;
        // 1. grants: CreateDataset and UseInUnion for src
        let grants = [];
    
        const create_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.CreateDataset,
            testCase.structure,
            false
        );
        grants.push(create_grant);

        await sleep(4000);

        for (const s of testCase.config){
            const g = await addGrant(
                TEST_PRINCIPAL, 
                testCase.secondLevelPerm,
                s,
                false
            );
            grants.push(g);
        }
        await sleep(4000);

        // 2. dataset_uuid = create dataset 
        const dataset_uuid = await test_fplus.DataAccess.create_dataset(testCase.structure, testCase.config);

        await sleep(2000);

        // 3. query the dataset's subclasses
        const subclasses = await admin_fplus.ConfigDB.class_subclasses(dataset_uuid);


        // 4. revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        // 5. delete dataset
        await deleteDataset(dataset_uuid);
        
        // 6. assert new dataset's subclasses include all the config sources
        expect(subclasses).toEqual(expect.arrayContaining(testCase.config));

    }, 30000);   
});