import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import * as Temp_Data from '../temp_data.js';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


describe('PUT /structure', () => {
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

    beforeAll(async () => {
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

    async function deleteDataset(uuid){
        if(!uuid) return;

        await admin_fplus.DataAccess.delete_dataset(uuid);
    }

    async function createDataset(structure, config){
        if(!structure || !config) return; 

        const uuid = await admin_fplus.DataAccess.create_dataset(
            structure,
            config
        )

        return uuid;
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


    test('Irrelevant permission', async() => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.CreateDataset,
            testCase,
            false
        );

        try {
            await test_fplus.DataAccess.update_dataset(
                testCase,
                Constants.App.SparkplugSrc,
                Temp_Data.Valid_Body.SRC.config
            );

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }
        await deleteGrant(grant);
    });

    
    test('Invalid Dataset UUID', async () => {
        try {
            await test_fplus.DataAccess.update_dataset(
                "xxx",
                Constants.App.SparkplugSrc,
                Temp_Data.Valid_Body.SRC.config
            );

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(422); 
        }
    });

    test.each(ALL_INVALID_BODY_CASES)('Invalid body cases - case %#', async (testCase) => {
        try {
            await test_fplus.DataAccess.update_dataset(
                Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
                testCase.structure,
                testCase.config
            );
            expect.fail('Expected to throw');

        } catch (err) {
            expect(err.status).toBe(422);
        }
    }, 30000);

    
    test.each([
        {   // Case 1: SRC
            uuid: Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset, 
            structure: Constants.App.UnionComponents, // intentionally wrong
            config: Temp_Data.Valid_Body.Union.config // intentionally wrong
        },
        {   // Case 2: Session
            uuid: Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
            structure: Constants.App.UnionComponents, // intentionally wrong
            config: Temp_Data.Valid_Body.Union.config 
        },
        {
            // Case 3: Union
            uuid: Temp_Data.Test_Uuids.Union_Datasets.TestUnionAllDataset,
            structure: Constants.App.SparkplugSrc,  // intentionally wrong
            config: Temp_Data.Valid_Body.SRC.config
        }
    ])('Unmatching structure for Valid datasets - case %#', async (testCase) => {
        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            testCase.uuid,
            false
        );
        
        await sleep(3600);

        try{
            await test_fplus.DataAccess.update_dataset(
                testCase.uuid,
                testCase.structure,
                testCase.config
            );
        }catch(err){
            expect(err.status).toBe(409);
        } finally{
            await deleteGrant(grant)
        }
    }, 30000);


    test.each([
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestDoubleDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestFloatDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
        
    ])('Update for Valid SRC - case %#', async (testCase) => {
        const dataset_uuid = await createDataset(testCase.structure, testCase.config);

        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_source = Temp_Data.Test_Uuids.Devices.Node2_TestDoubleDevice;
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_source, false);

        await sleep(5000);

        await test_fplus.DataAccess.update_dataset(
            dataset_uuid,
            testCase.structure,
            {
                source: new_source
            }
        );
        await sleep(3000);

        const updated_config = await admin_fplus.ConfigDB.get_config(
            testCase.structure,
            dataset_uuid
        );


        await deleteGrant(grant1);
        await deleteGrant(grant2);
        await deleteDataset(dataset_uuid);


        expect(updated_config.source).toEqual(new_source);

    }, 30000);



    test.each([
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
                from: "2026-06-01T08:52:00.000Z",
                to: "2026-06-01T11:55:00.000Z",
            },
            secondLevelPerm: Constants.Perm.UseForSession
        },
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Temp_Data.Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset,
                from: "2026-07-01T08:52:00.000Z",
                to: "2026-08-01T11:55:00.000Z",
            },
            secondLevelPerm: Constants.Perm.UseForSession
        },
        
    ])('Successful update for Valid Session - case %#', async (testCase) => {

        const dataset_uuid = await createDataset(testCase.structure, testCase.config);
        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_config = {
            source: Temp_Data.Test_Uuids.Src_Datasets.TestDeviceDataset,
            from: "2026-07-01T08:52:00.000Z",
            to: "2026-08-01T11:55:00.000Z",
        };
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_config.source, false);

        await sleep(4000);

        await test_fplus.DataAccess.update_dataset(
            dataset_uuid,
            testCase.structure,
            new_config
        );
        await sleep(3000);

        const updated_config = await admin_fplus.ConfigDB.get_config(
            testCase.structure,
            dataset_uuid
        );

        const old_source_subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(testCase.config.source);
        const new_source_subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(new_config.source);

        await deleteDataset(dataset_uuid);
        await deleteGrant(grant1);
        await deleteGrant(grant2);

        expect(updated_config.source).toEqual(new_config.source);
        expect(old_source_subclasses).not.toContain(dataset_uuid);
        expect(new_source_subclasses).toContain(dataset_uuid);

    }, 40000);




    test.each([
        {
            structure: Constants.App.UnionComponents,
            config: [
                Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
                Temp_Data.Test_Uuids.Session_Datasets.TestSessionAllDataset
            ],
            secondLevelPerm: Constants.Perm.IncludeInUnion
        },
        {
            structure: Constants.App.UnionComponents,
            config: [
                Temp_Data.Test_Uuids.Union_Datasets.TestUnionAllDataset,
                Temp_Data.Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset
            ],
            secondLevelPerm: Constants.Perm.IncludeInUnion
        },
    ])('Successful update for Valid Union', async (testCase) => {
        const dataset_uuid = await createDataset(testCase.structure, testCase.config);
        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_source = Temp_Data.Test_Uuids.Union_Datasets.TestNestedUnionDataset;
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_source, false);

        await sleep(4000);

        await test_fplus.DataAccess.update_dataset(dataset_uuid, testCase.structure, [new_source]);

        await sleep(2000);

        const updated_config = await admin_fplus.ConfigDB.get_config(
            testCase.structure,
            dataset_uuid
        );

        await sleep(5000)

        


        const subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(dataset_uuid);



        await deleteDataset(dataset_uuid);
        await deleteGrant(grant1);
        await deleteGrant(grant2);


        expect(updated_config).toContain(new_source);
        for (let old_src of testCase.config){
            expect(subclasses).not.toContain(old_src);
        }
        expect(subclasses).toContain(new_source);
    }, 40000);



    test.each([
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestDoubleDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: Temp_Data.Test_Uuids.Devices.TestFloatDevice
            },
            secondLevelPerm: Constants.Perm.UseSparkplug
        },
    ])('Successful update for Invalid SRC', async (testCase) => {
        // create dataset and give edit grant
        const dataset_uuid = await createDataset(testCase.structure, testCase.config);
        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_source = Temp_Data.Test_Uuids.Devices.Node2_TestFloutDevice;
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_source, false);

        await sleep(4000);
    

        // make it invalid 
        const invalid_structure = Constants.App.SessionLimits;
        await addConfig(invalid_structure, dataset_uuid,{"source": "invalid source"} )
       
        await sleep(4000);


        // update dataset
        await test_fplus.DataAccess.update_dataset(dataset_uuid, testCase.structure, {source: new_source});
        await sleep(4000);

        const updated_structure = await test_fplus.DataAccess.get_single_structure(dataset_uuid);

        // delete grants
        await deleteGrant(grant1);
        await deleteGrant(grant2);

        // delete dataset
        await deleteDataset(dataset_uuid);

        expect(updated_structure.structure).toEqual(testCase.structure);
        expect(updated_structure.config.source).toEqual(new_source);
    }, 30000);




    test.each([
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
                from: "2026-06-01T08:52:00.000Z",
                to: "2026-06-01T11:55:00.000Z",
            },
            secondLevelPerm: Constants.Perm.UseForSession
        },
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Temp_Data.Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset,
                from: "2026-07-01T08:52:00.000Z",
                to: "2026-08-01T11:55:00.000Z",
            },
            secondLevelPerm: Constants.Perm.UseForSession
        },
        
    ])('Successful update for Invalid Session', async (testCase) => {
        const dataset_uuid = await createDataset(testCase.structure, testCase.config);
        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_config = {
            source: Temp_Data.Test_Uuids.Src_Datasets.TestDeviceDataset,
            from: "2026-07-01T08:52:00.000Z",
            to: "2026-08-01T11:55:00.000Z",
        };
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_config.source, false);

        await sleep(4000);


        // make it invalid 
        const invalid_structure = Constants.App.SparkplugSrc;
        await addConfig(invalid_structure, dataset_uuid,{"source": "invalid source"} )
       
        await sleep(4000);

        await test_fplus.DataAccess.update_dataset(
            dataset_uuid,
            testCase.structure,
            new_config
        );
        await sleep(3000);


        const old_source_subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(testCase.config.source);
        const new_source_subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(new_config.source);

        const updated_structure = await test_fplus.DataAccess.get_single_structure(dataset_uuid);

        await deleteDataset(dataset_uuid);
        await deleteGrant(grant1);
        await deleteGrant(grant2);

        expect(updated_structure.structure).toEqual(testCase.structure);
        expect(updated_structure.config.source).toEqual(new_config.source);
        expect(old_source_subclasses).toContain(dataset_uuid);
        expect(new_source_subclasses).toContain(dataset_uuid);

    }, 40000);



    test.each([
        {
            structure: Constants.App.UnionComponents,
            config: [
                Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
                Temp_Data.Test_Uuids.Session_Datasets.TestSessionAllDataset
            ],
            secondLevelPerm: Constants.Perm.IncludeInUnion
        },
        {
            structure: Constants.App.UnionComponents,
            config: [
                Temp_Data.Test_Uuids.Union_Datasets.TestUnionAllDataset,
                Temp_Data.Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset
            ],
            secondLevelPerm: Constants.Perm.IncludeInUnion
        },
    ])('Successful update for Invalid Union', async (testCase) => {
        const dataset_uuid = await createDataset(testCase.structure, testCase.config);
        const grant1 = await addGrant(TEST_PRINCIPAL, Constants.Perm.EditDataset, dataset_uuid, false);

        const new_source = Temp_Data.Test_Uuids.Union_Datasets.TestNestedUnionDataset;
        const grant2 = await addGrant(TEST_PRINCIPAL, testCase.secondLevelPerm, new_source, false);

        await sleep(4000);


        // make it invalid 
        const invalid_structure = Constants.App.SparkplugSrc;
        await addConfig(invalid_structure, dataset_uuid,{"source": "invalid source"} )
       
        await sleep(4000);



        await test_fplus.DataAccess.update_dataset(dataset_uuid, testCase.structure, [new_source]);

        await sleep(4000);

        const updated_structure = await test_fplus.DataAccess.get_single_structure(dataset_uuid);
        const subclasses = await admin_fplus.ConfigDB.class_direct_subclasses(dataset_uuid);

        await deleteDataset(dataset_uuid);
        await deleteGrant(grant1);
        await deleteGrant(grant2);

        expect(updated_structure.structure).toEqual(testCase.structure);
        
        expect(updated_structure.config).toContain(new_source);

        for (let old_src of testCase.config){
            expect(subclasses).toContain(old_src);
        }
        expect(subclasses).toContain(new_source);
    }, 40000);

});