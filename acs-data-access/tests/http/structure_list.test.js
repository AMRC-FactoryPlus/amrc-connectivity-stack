import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import { Test_Uuids } from "../temp_data.js";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /structure', () => {
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
        await sleep(500); 
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

    test('Datasets exist but user has no permissions', async () => {
        const res = await test_fplus.DataAccess.get_structure_list();
        expect(res).toEqual([]);
    });

    test('User has unrelated permission to one dataset', async () => {
        const dataset_uuid = Test_Uuids.Src_Datasets.TestDeviceDataset;
        
        // Grant unrelated permission to the user
        const grant_uuid = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            dataset_uuid,
            false
        );
        await sleep(1000);

        const res = await test_fplus.DataAccess.get_structure_list();

        await deleteGrant(grant_uuid);
        
        expect(res).toEqual([]);
    });

    test('User has correct permission to one dataset', async () => {
        const dataset_uuid = Test_Uuids.Src_Datasets.TestDeviceDataset;

        // Grant correct permission
        const grant_uuid = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            dataset_uuid,
            false
        );
        await sleep(1000);

        const res = await test_fplus.DataAccess.get_structure_list();

        await deleteGrant(grant_uuid);

        expect(res).toContain(dataset_uuid);

    });

    test('User has correct permission to multiple datasets', async () => {
        const datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset, 
            Test_Uuids.Session_Datasets.TestSessionAllDataset,
        ];


        // Add grants
        let grants = [];
        
        for (let dataset_uuid of datasets){
            const grant_uuid = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                dataset_uuid,
                false
            )
            grants.push(grant_uuid);
        }

        await sleep(1000);

        const res = await test_fplus.DataAccess.get_structure_list();

        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));
    });

    test('Multiple datasets, some have relevant permission', async () => {
        const datasets = {
            Relevant: Test_Uuids.Src_Datasets.TestDeviceDataset, 
            Irrelevant: Test_Uuids.Session_Datasets.TestSessionAllDataset
        };

        // ======== add grants ======
        let grants = [];
        const relevant_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            datasets.Relevant,
            false
        );
        grants.push(relevant_grant);

        const irrelevant_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            datasets.Irrelevant,
            false
        );
        grants.push(irrelevant_grant);

        await sleep(1000);

        // =========================


        const res = await test_fplus.DataAccess.get_structure_list();

        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        expect(res).toHaveLength(1);
        expect(res).toContain(datasets.Relevant);
        expect(res).not.toContain(datasets.Irrelevant);
    });


    test('Multiple (simple SRC) datasets with relevant permissions, invalid ones must be invcluded', async () => {
        const datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset,
            Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
            Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset
        ];


        // ----- add grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);

        // ---------------------

        
        const invalid_dataset = Test_Uuids.Src_Datasets.TestDeviceDataset;
        const invalid_structure = Constants.App.UnionComponents;


        // make dataset invalid
        await addConfig(
            invalid_structure,
            invalid_dataset,
            []
        );
        await sleep(1000);

        // =========================

        const res = await test_fplus.DataAccess.get_structure_list();

        await sleep(1000);

        // ==== remove invalid config ======
        await removeConfig(invalid_structure, invalid_dataset);
        await sleep(500);

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));
    }, 30000);


    test('Invalid Parent (Union) composed of only SRC - all included', async () => {
        const invalid_parent_dataset = Test_Uuids.Union_Datasets.TestDoublesUnionDataset;
        const invalid_structure = Constants.App.SparkplugSrc;
        
        const child_datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset,
            Test_Uuids.Src_Datasets.TestDoubleDeviceDataset
        ];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_structure_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

    }, 30000);

    test('Invalid Parent (Union) composed of Session and Union - all included', async () => {

        const invalid_parent_dataset = Test_Uuids.Union_Datasets.TestNestedUnionDataset;
        const invalid_structure = Constants.App.SparkplugSrc;

        const child_datasets = [
            Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
            Test_Uuids.Union_Datasets.TestDoublesUnionDataset
        ];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_structure_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));
    }, 30000);


    test('Invalid Parent (Session) dataset composed of (Union) - all included', async () => {
        const invalid_parent_dataset = Test_Uuids.Session_Datasets.TestSessionAllDataset;
        const invalid_structure = Constants.App.SparkplugSrc;

        const child_datasets = [Test_Uuids.Union_Datasets.TestUnionAllDataset];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add  grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);

        const res = await test_fplus.DataAccess.get_structure_list();
        
        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

    }, 30000);

    test('Invalid Child (SRC) invalidates Parent (Union) - all included', async () => {
        const invalid_child_dataset = Test_Uuids.Src_Datasets.TestDeviceDataset;
        const invalid_structure = Constants.App.SessionLimits;

        const parent_dataset = Test_Uuids.Union_Datasets.TestUnionAllDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset
        ];

        // ---- add  grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_child_dataset,
            {
                "source": "invalid",
                "from": "invalid",
                "to": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_structure_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

    }, 30000);

    test('Invalid Child (Union) invalidates Parent (Session) - all included', async () => {
        const invalid_child_dataset = Test_Uuids.Union_Datasets.TestUnionAllDataset;
        const invalid_structure = Constants.App.SparkplugSrc;
        const parent_dataset = Test_Uuids.Session_Datasets.TestSessionAllDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset
        ];

        // ---- add  grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_child_dataset,
            {
                "source": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_structure_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

    }, 30000);


    test('Invalid Child (Session) invalidates Parent (Union)', async () => {
        const invalid_child_dataset = Test_Uuids.Session_Datasets.SessionNode2DoubleDataset;
        const invalid_structure = Constants.App.SparkplugSrc;

        const valid_child_dataset = Test_Uuids.Union_Datasets.TestDoublesUnionDataset;
        const parent_dataset = Test_Uuids.Union_Datasets.TestNestedUnionDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset,
            valid_child_dataset
        ];

        // ---- add  grants ---
        const grants = [];
        for (let uuid of datasets){
            const relevant_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.EditDataset,
                uuid,
                false
            );
            grants.push(relevant_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            invalid_structure,
            invalid_child_dataset,
            {
                "source": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_structure_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            invalid_structure,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

    }, 30000);
});