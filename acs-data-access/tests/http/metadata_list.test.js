import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import {Test_Uuids} from '../temp_uuids.js';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /metadata', () => {
    let test_fplus; 
    let admin_fplus;
    const TEST_PRINCIPAL=process.env.TEST_HUMAN_UUID;

    let ALL_GRANTS = [];

    beforeAll(async () => {
        admin_fplus = new ServiceClient({
            directory_url: process.env.DIRECTORY_URL,
            username: process.env.ADMIN_USERNAME,
            password: process.env.ADMIN_PASSWORD,
            verbose: 'ALL'
        });
    });

    
    beforeEach(async () => {
        test_fplus = new ServiceClient({
            directory_url: process.env.DIRECTORY_URL,
            username: process.env.TEST_HUMAN_USERNAME,
            password: process.env.TEST_HUMAN_PASSWORD,
            verbose: 'ALL'
        });
        await sleep(1000); // 
    });


    // Clean up grants if not removed in case of failure.
    afterAll(async () => {
        if(ALL_GRANTS.length > 0){
            for (let grant of ALL_GRANTS){
                await deleteGrant(grant);
            }
        }
    });


    async function addGrant(principal, permission, target, plural){
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
        await admin_fplus.Auth.delete_grant(grant_uuid)
        ALL_GRANTS = ALL_GRANTS.filter(uuid => uuid !== grant_uuid);
    }

    async function addConfig(app, obj, config){
        await admin_fplus.ConfigDB.put_config( app, obj, config );
    }

    async function removeConfig(app, obj){
        await admin_fplus.ConfigDB.delete_config( app, obj );
    }

    test('Datasets exist but user has no permissions', async () => {
        const res = await test_fplus.DataAccess.get_metadata_list();
        expect(res).toEqual([]);
    });

    test('User has unrelated permission to one dataset', async () => {
        const dataset_uuid = Test_Uuids.Src_Datasets.TestDeviceDataset;
        
        // Grant unrelated EditDataset permission to the user
        const grant_uuid = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            dataset_uuid,
            false
        );
        await sleep(1000);


        const res = await test_fplus.DataAccess.get_metadata_list();


        await deleteGrant(grant_uuid);
        
        expect(res).toEqual([]);
    });

    test('User has correct Read permission to one dataset', async () => {
        const dataset_uuid = Test_Uuids.Src_Datasets.TestDeviceDataset;

        // Grant correct permission
        const grant_uuid = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            dataset_uuid,
            false
        );
        await sleep(1000);

        const res = await test_fplus.DataAccess.get_metadata_list();

        await deleteGrant(grant_uuid);

        expect(res).toContain(dataset_uuid);

    });

    test('User has correct permission to multiple datasets', async () => {
        const datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset, 
            Test_Uuids.Session_Datasets.TestSessionAllDataset
        ];

        // Add read grants
        let grants = [];
        for (let dataset_uuid of datasets){
            const grant_uuid = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                dataset_uuid,
                false
            )
            grants.push(grant_uuid);
        }

        await sleep(1000);

        const res = await test_fplus.DataAccess.get_metadata_list();

        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));
    });

    test('Multiple datasets, some readable', async () => {
        const datasets = {
            Readable: Test_Uuids.Src_Datasets.TestDeviceDataset, 
            Unreadable: Test_Uuids.Session_Datasets.TestSessionAllDataset
        };

        // ======== add grants ======
        let grants = [];
        const read_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            datasets.Readable,
            false
        );
        grants.push(read_grant);

        const edit_grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            datasets.Unreadable,
            false
        );
        grants.push(edit_grant);

        await sleep(1000);

        // =========================


        const res = await test_fplus.DataAccess.get_metadata_list();

        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        expect(res).toHaveLength(1);
        expect(res).toContain(datasets.Readable);
    });

    test('Multiple (simple SRC) datasets with Read permissions, invalid ones must be excluded', async () => {
        const datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset,
            Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
            Test_Uuids.Src_Datasets.Node2_TestFloutDeviceDataset
        ];


        // ----- add grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);

        // ---------------------

        
        const invalid_dataset = datasets[0];

        // make dataset invalid
        await addConfig(
            Constants.App.UnionComponents,
            invalid_dataset,
            []
        );
        await sleep(1000);

        // =========================

        const res = await test_fplus.DataAccess.get_metadata_list();

        await sleep(1000);

        // ==== remove invalid config ======
        await removeConfig(Constants.App.SparkplugSrc, invalid_dataset);
        await sleep(500);

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(2);
        expect(res).not.toContain(invalid_dataset);
    }, 30000);

    /**
     * Invalid union dataset is not returned. 
     * But the child datasets should still be returned as long as they are valid on their own and have ReadDataset permission.
     */
    test('Invalid Parent (Union) composed of only SRC does not invalidate children', async () => {
        const invalid_parent_dataset = Test_Uuids.Union_Datasets.TestDoublesUnionDataset;
        const child_datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset,
            Test_Uuids.Src_Datasets.TestDoubleDeviceDataset
        ];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(child_datasets.length);
        expect(res).not.toContain(invalid_parent_dataset);

    }, 30000);

    /**
     * Union dataset composed of:
     *  > SessionNode2DoubleDataset:
     *      > Node2_TestDoubleDeviceDataset - source dataset
     *  > TestDoublesUnionDataset: 
     *      > TestDeviceDataset - source dataset
     *      > TestDoubleDeviceDataset - source dataset
     */

    test('Invalid Parent (Union) composed of Session and Union does NOT invalidate children', async () => {

        const invalid_parent_dataset = Test_Uuids.Union_Datasets.TestNestedUnionDataset;
        const child_datasets = [
            Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
            Test_Uuids.Union_Datasets.TestDoublesUnionDataset
        ];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
        expect(res).toHaveLength(child_datasets.length);
        expect(res).not.toContain(invalid_parent_dataset);
    }, 30000);


    test('Invalid Parent (Session) dataset composed of (Union) child does NOT invalidate children', async () => {
        const invalid_parent_dataset = Test_Uuids.Session_Datasets.TestSessionAllDataset;
        const child_datasets = [Test_Uuids.Union_Datasets.TestUnionAllDataset];

        const datasets = [
            invalid_parent_dataset,
            ...child_datasets
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);

        const res = await test_fplus.DataAccess.get_metadata_list();
        
        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SparkplugSrc,
            invalid_parent_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(child_datasets.length);
        expect(res).not.toContain(invalid_parent_dataset);

    }, 30000);



    test('Invalid Child (SRC) invalidates Parent (Union)', async () => {
        const invalid_child_dataset = Test_Uuids.Src_Datasets.TestDeviceDataset;
        const parent_dataset = Test_Uuids.Union_Datasets.TestUnionAllDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SessionLimits,
            invalid_child_dataset,
            {
                "source": "invalid",
                "from": "invalid",
                "to": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SessionLimits,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(0);

    }, 30000);




    test('Invalid Child (Union) invalidates Parent (Session)', async () => {
        const invalid_child_dataset = Test_Uuids.Union_Datasets.TestUnionAllDataset;
        const parent_dataset = Test_Uuids.Session_Datasets.TestSessionAllDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SparkplugSrc,
            invalid_child_dataset,
            {
                "source": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();

        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SparkplugSrc,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).toHaveLength(0);

    }, 30000);



    test.only('Invalid Child (Session) invalidates Parent (Union)', async () => {
        const invalid_child_dataset = Test_Uuids.Session_Datasets.SessionNode2DoubleDataset;
        const valid_child_dataset = Test_Uuids.Union_Datasets.TestDoublesUnionDataset;
        const parent_dataset = Test_Uuids.Union_Datasets.TestNestedUnionDataset;

        const datasets = [
            invalid_child_dataset,
            parent_dataset,
            valid_child_dataset
        ];

        // ---- add READ grants ---
        const grants = [];
        for (let uuid of datasets){
            const read_grant = await addGrant(
                TEST_PRINCIPAL,
                Constants.Perm.ReadDataset,
                uuid,
                false
            );
            grants.push(read_grant);
        }

        await sleep(1000);


        // ---- Make Union dataset invalid
        await addConfig(
            Constants.App.SparkplugSrc,
            invalid_child_dataset,
            {
                "source": "invalid"
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();
        console.log(res);
        // ---- Make Union dataset valid again
        await removeConfig(
            Constants.App.SparkplugSrc,
            invalid_child_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

        expect(res).not.toContain(parent_dataset);
        expect(res).not.toContain(invalid_child_dataset);
        expect(res).toContain(valid_child_dataset);

    }, 30000);
});


