import {ServiceClient} from "@amrc-factoryplus/service-client";
import process from "node:process";
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import { DataAccess as Constants } from "../../lib/constants.js";
import * as Temp_Data from '../temp_data.js';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GET /metadata/:uuid', () => {
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
            const res = await test_fplus.DataAccess.get_single_metadata(testCase);

            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }
    });

    test('User has irrelevant permission to the dataset', async () => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.TestDeviceDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.EditDataset,
            testCase,
            false
        );

        try {
            const res = await test_fplus.DataAccess.get_single_metadata(testCase);
            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(403); 
        }
        finally{
            await deleteGrant(grant);

        }
    });

    test('Invalid uuid', async () => {
        const testCase = 'xxx';

        try {
            const res = await test_fplus.DataAccess.get_single_metadata(testCase);
            expect.fail('Expected to throw');
        }
        catch (err) {
            expect(err.status).toBe(422); 
        }
    });

    test('Invalid dataset -> Not found', async () => {
        const testCase = Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset;
        const invalidApp = Constants.App.UnionComponents;

        // Grant
        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
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
        await sleep(4000);

        const res = await test_fplus.DataAccess.get_single_metadata(testCase);

        // make testCase valid 
        await removeConfig(invalidApp, testCase);        

        // revoke grant
        await deleteGrant(grant);

        expect(res).toEqual({});
    }, 40000);


    /** Session type metadata object props:
     *      - uuid
     *      - name
     *      - from
     *      - to
     *      - function (opt)
     *      - metadata (opt)
     *      - parts
     */
    test('Session format', async () => {
        const testCase = Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            testCase,
            false
        );

        await sleep(3600);

        const res = await test_fplus.DataAccess.get_single_metadata(testCase);

        await deleteGrant(grant);
        
        expect(res).toEqual(expect.objectContaining({
            'uuid': testCase,
            'name': 'SessionNode2DoubleDataset',
            'from': '2026-06-01T08:52:00.000Z',
            'to': '2026-06-01T11:55:00.000Z',
            'parts': [testCase],
        }));

        expect(res.function).toEqual(expect.arrayContaining(
            [
                Temp_Data.Test_Uuids.Mes.MesDataset,
                Temp_Data.Test_Uuids.Mes.MesEquipment,
                Temp_Data.Test_Uuids.Mes.MesOperation,
                Temp_Data.Test_Uuids.Mes.MesProduct,
                Temp_Data.Test_Uuids.Mes.MesWorkorder,
            ]
        ));
        expect(res.metadata).toHaveProperty(Temp_Data.Test_Uuids.Mes.App);
    });

    test('SRC format', async () => {
        const testCase = Temp_Data.Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            testCase,
            false
        );

        await sleep(3600);

        const res = await test_fplus.DataAccess.get_single_metadata(testCase);

        await deleteGrant(grant);

        expect(res).not.haveOwnProperty('from');
        expect(res).not.haveOwnProperty('to');
        
        
        expect(res).toEqual(expect.objectContaining({
            'uuid': testCase,
            'name': 'Node2_TestDoubleDeviceDataset',
            'parts': [testCase]
        }));

    });


// {
//   uuid: '21e0dfa8-f044-4e87-8606-f528686205d8',
//   name: 'TestNestedUnionDataset',
//   from: '2026-04-02T13:00:00.000Z',
//   to: '2026-06-01T11:55:00.000Z',
//   parts: [ '21e0dfa8-f044-4e87-8606-f528686205d8' ]
// }


// {
//   "to": "2026-06-01T11:55:00.000Z",
//   "from": "2026-06-01T08:52:00.000Z",
//   "source": "720ecd5a-c5d2-49d5-bf5a-8ca01dfdb7df"
// }


// {
//   "to": "2026-06-01T10:00:00.000Z",
//   "from": "2026-04-02T13:00:00.000Z",
//   "source": "e2a4c530-dc0f-417d-b00b-329b0e90e033"
// }
    test('Union format', async () => {
        const testCase = Temp_Data.Test_Uuids.Union_Datasets.TestNestedUnionDataset;

        const grant = await addGrant(
            TEST_PRINCIPAL,
            Constants.Perm.ReadDataset,
            Constants.Class.Dataset,
            true
        );

        await sleep(3600);

        const res = await test_fplus.DataAccess.get_single_metadata(testCase);

        await deleteGrant(grant);


        expect(res).toEqual(expect.objectContaining({
            'from': '2026-04-02T13:00:00.000Z',
            'to': '2026-06-01T11:55:00.000Z',
            'uuid': testCase,
            'name': 'TestNestedUnionDataset',
        }));

        expect(res.parts).toEqual(expect.arrayContaining(
            [
                Temp_Data.Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
                Temp_Data.Test_Uuids.Session_Datasets.TestSessionAllDataset
            ]
        ));
        expect(res.function).toEqual(expect.arrayContaining(
            [
                Temp_Data.Test_Uuids.Mes.MesOperation,
                Temp_Data.Test_Uuids.Mes.MesDataset
            ]
        ));
    });
});