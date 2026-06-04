import { config } from "rxjs";
import { DataAccess as Constants } from "../lib/constants.js";

export const Test_Uuids = {
    Devices: { 
        TestDevice: "5880686f-13f9-4089-b236-825d002bc911",
        TestDoubleDevice: "1298e74a-37d3-4717-aba1-4c1e67b953c1",
        TestFloatDevice: "34b6910c-85ec-445b-9071-0813891e6ff7",

        Node2_TestDoubleDevice: "d60d00bf-eae7-4f88-9ad2-cfc4c638ac7b",
        Node2_TestFloutDevice: "961cb1c0-3d00-44e8-90bc-3fdf917746fc"
    },

    Src_Datasets: {
        Node2_TestDoubleDeviceDataset: "720ecd5a-c5d2-49d5-bf5a-8ca01dfdb7df",
        Node2_TestFloutDeviceDataset: "9975fb51-ed1c-4bc9-a845-331c801f140f",
        TestDeviceDataset: "492194aa-4ced-44d1-96c1-4e09e4d52f45",
        TestDoubleDeviceDataset: "3af79d1f-bdc2-41a8-bf2b-bd16af8a92a2",
        TestFloatDeviceDataset: "3dc230e9-ab36-4729-8d93-6d5c421f7d7f",
    },

    Union_Datasets: {
        TestDoublesUnionDataset: "f0f1da5d-7a9d-431a-afd1-eec467ed21cb",
        TestNestedUnionDataset: "21e0dfa8-f044-4e87-8606-f528686205d8",
        TestUnionAllDataset: "e2a4c530-dc0f-417d-b00b-329b0e90e033",
    },

    Session_Datasets: {
        SessionNode2DoubleDataset: "811da559-727b-4808-8d99-c31f90520966",
        TestSessionAllDataset: "74cac8a1-88a6-4b08-b297-a3c05a388ec5",
    }
}

export const Valid_Body = {
    SRC: {
        structure: Constants.App.SparkplugSrc,
        config: {
            source: Test_Uuids.Devices.Node2_TestDoubleDevice
        },
        secondLevelPerm: Constants.Perm.UseSparkplug
    },

    Session: {
        structure: Constants.App.SessionLimits,
        config: {
            source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
            from: "2026-06-01T08:52:00.000Z",
            to: "2026-06-01T11:55:00.000Z",
        },
        secondLevelPerm: Constants.Perm.UseForSession
    },

    Union: {
        structure: Constants.App.UnionComponents,
        config: [
            Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
            Test_Uuids.Union_Datasets.TestDoublesUnionDataset
        ],
        secondLevelPerm: Constants.Perm.IncludeInUnion
    }
}


export const Invalid_Body_Structure = [
    // Invalid_No_Structure
    {
        config: {
            source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset
        }
    },

    // Invalid_Bad_Structure_Uuid
    {
        structure: 'xxx',
        config: {
            source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset
        }
    },

    // Invalid_Unhandled_Structure_Type
    {
        structure: '74cac8a1-88a6-4b08-b297-a3c05a388ec5',
        config: {
            source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset
        }
    }
]

export const Invalid_Body_Config = {
    SRC:[
        // no config
        {
            structure: Constants.App.SparkplugSrc
        },

        // Invalid_No_Source
        {
            structure: Constants.App.SparkplugSrc,
            config: {}
        },

        // Invalid_Bad_Source_Uuid for SRC
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: 'xxx'
            }
        },

        // Invalid_No_Config for SRC 
        {
            structure: Constants.App.SparkplugSrc,
            undefined
        },

        // Invalid_Config_Format for SRC
        {
            structure: Constants.App.SparkplugSrc,
            config: []
        },

        // Invalid_Bad_Child_Uuid for SRC
        {
            structure: Constants.App.SparkplugSrc,
            config: {
                source: "xxx"
            }
        }
    ],
    Session:[
        // Invalid_No_Source: 
        {
            structure: Constants.App.SessionLimits,
            config: {
                from: "2026-06-01T08:52:00.000Z",
                to: "2026-06-01T11:55:00.000Z",
            }
        },

        // Invalid_No_From:
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
                to: "2026-06-01T11:55:00.000Z",
            }
        },

        // Invalid_No_To:
        {
            structure: Constants.App.SessionLimits,
            config: {
                source: Test_Uuids.Src_Datasets.Node2_TestDoubleDeviceDataset,
                from: "2026-06-01T08:52:00.000Z",
            }
        },

        // Invalid config format
        {
            structure: Constants.App.SessionLimits,
            config: []
        },
        
        // Empty config
        {
            structure: Constants.App.SessionLimits,
            config: {}
        },

        // No config
        {
            structure: Constants.App.SessionLimits
        },
    ],
    Union: [
        // no config
        {
            structure: Constants.App.UnionComponents,
        },

        // config wrong format
        {
            structure: Constants.App.UnionComponents,
            config: {}
        },

        // invalid source uuid
        {
            structure: Constants.App.UnionComponents,
            config: [
                Test_Uuids.Session_Datasets.SessionNode2DoubleDataset,
                "xxx",
                Test_Uuids.Session_Datasets.TestSessionAllDataset,
            ]
        },
    ],
}


