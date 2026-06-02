import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {beforeAll, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import {Test_Uuids} from '../temp_uuids.js';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /metadata', () => {
    let test_fplus; 
    let admin_fplus;
    let TEST_PRINCIPAL;

    beforeAll(async () => {
        TEST_PRINCIPAL = "bbbca528-3099-47c9-ab25-e95e1ea06e93";

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

    });



    async function addGrant(principal, permission, target, plural){
        const grant_uuid = await admin_fplus.Auth.add_grant({
            principal,
            permission,
            target,
            plural
        });

        return grant_uuid;
    }

    async function deleteGrant(grant_uuid){
        await admin_fplus.Auth.delete_grant(grant_uuid)
    }

    async function makeInvalid(dataset_uuid, app){
        
    }

    async function makeValid(dataset_uuid, app){

    }

    test('Datasets exist but user has no permissions', async () => {
        const res = await fplus.DataAccess.get_metadata_list();
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
        expect(res).toEqual([]);

        await deleteGrant(grant_uuid);
        await sleep(1000);
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
        expect(res).toContain(dataset_uuid);

        await deleteGrant(grant_uuid);

        await sleep(100);
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
        expect(res).toHaveLength(datasets.length);
        expect(res).toEqual(expect.arrayContaining(datasets));

        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        
        await sleep(100);
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
        expect(res).toHaveLength(1);
        expect(res).toContain(datasets.Readable);


        // Revoke grants
        for(let grant of grants){
            await deleteGrant(grant);
        }
        
        await sleep(100);
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
        await admin_fplus.ConfigDB.put_config(
            Constants.App.UnionComponents,
            invalid_dataset,
            []
        );
        await sleep(1000);

        // =========================

        const res = await test_fplus.DataAccess.get_metadata_list();

        expect(res).toHaveLength(2);
        expect(res).not.toContain(invalid_dataset);

        await sleep(1000);

        // ==== remove invalid config ======
        await admin_fplus.ConfigDB.delete_config(
            Constants.App.SparkplugSrc,
            invalid_dataset
        );

        await sleep(500);

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }
    }, 30000);


    test.only('Invalid Union dataset composed of only Src datasets', async () => {
        const invalid_union_dataset = Test_Uuids.Union_Datasets.TestDoublesUnionDataset;
        const child_datasets = [
            Test_Uuids.Src_Datasets.TestDeviceDataset,
            Test_Uuids.Src_Datasets.TestDoubleDeviceDataset
        ];

        const datasets = [
            invalid_union_dataset,
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
        await admin_fplus.ConfigDB.put_config(
            Constants.App.SparkplugSrc,
            invalid_union_dataset,
            {
                "source": Test_Uuids.Devices.Node2_TestDoubleDevice
            }
        );

        await sleep(500);


        const res = await test_fplus.DataAccess.get_metadata_list();
        console.log(res);

        
        expect(res).toHaveLength(child_datasets.length);
        expect(res).not.toContain(invalid_union_dataset);


        // ---- Make Union dataset valid again
        await admin_fplus.ConfigDB.delete_config(
            Constants.App.SparkplugSrc,
            invalid_union_dataset
        );

        // ==== Revoke grants ====
        for (let uuid of grants){
            await deleteGrant(uuid);
        }

    }, 30000);
});


