/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// UUIDs used by the Datasets pages. They match acs-service-setup
// (lib/uuids.js, dumps/data-access.yaml).

export const DA = {
    App: {
        DatasetDefinition:  'eae2d4ae-164d-4dc6-b646-7e0320057bd9',
        DatasetMetadata:    'e3b9fd2c-9de1-470b-9675-739e2a55b77f',
        SparkplugSrc:       'f5d550c4-2831-11f1-b0b0-83fda3035799',
        UnionComponents:    '1c4ca454-de38-44d9-92fb-aa5218bfa257',
        SessionLimits:      '8754c000-3778-4ae6-b2b8-bbcd959bb775',
        MESIdentifiers:     'af178f0c-3b1e-44f2-9724-5cf06e8fd056',
        // Metadata written by the Admin UI. Each is a member of
        // DatasetMetadata, so Data Access returns it with the dataset.
        Tags:               'c95e372e-2fbe-45b9-9937-3235f94e22a3',
        EquipmentLabels:    'dfc3983b-658c-4099-b76a-01ce7c18bde1',
        RunMetadata:        '2b2b4dbc-e0a0-474e-93a8-257bbcbb7f7a',
        Recording:          'cf3f6103-0f0e-4839-953a-ad2cedc78c30',
    },
    Class: {
        Dataset:            'c31d3cbd-01cd-4833-8014-c4512aef1e5c',
        MESDataset:         '586205bf-81c6-4091-9d2c-f3c0465ebdc4',
        Equipment:          '4c93ddc1-e610-4efe-91e3-a355f9ba1a09',
        WorkOrder:          'b416e44c-c57e-4486-9431-64c425f1b2c6',
        Product:            '4a089748-b26b-4f12-8f1a-164bfba97809',
        Operation:          'bd0354eb-b8f7-4bd9-8407-0588e545603c',
        Run:                '3c866b35-66a1-4cb8-8db2-dae284883cf8',
    },
    Special: {
        InvalidDataset:     '696396a0-2831-11f1-9b12-33d63b8c5115',
    },
}

export const STRUCTURE = {
    DEVICE:  DA.App.SparkplugSrc,
    UNION:   DA.App.UnionComponents,
    SESSION: DA.App.SessionLimits,
    INVALID: DA.Special.InvalidDataset,
}

// The kinds a person can give a dataset. A process is stored as an MES
// operation and a part as an MES product.
export const KINDS = [
    { id: 'equipment', label: 'Equipment', plural: 'Equipment', icon: 'industry',        klass: DA.Class.Equipment,
      help: 'A machine or rig: a group of devices with no time window.' },
    { id: 'run',       label: 'Run',       plural: 'Runs',      icon: 'stopwatch',       klass: DA.Class.Run,
      help: 'One time window on one piece of equipment.' },
    { id: 'process',   label: 'Process',   plural: 'Processes', icon: 'diagram-project', klass: DA.Class.Operation,
      help: 'A group of runs of the same process.' },
    { id: 'part',      label: 'Part',      plural: 'Parts',     icon: 'cube',            klass: DA.Class.Product,
      help: 'A group of runs that made one part.' },
]

export const KIND_BY_ID = Object.fromEntries(KINDS.map(k => [k.id, k]))

export const OTHER_KIND = { id: 'other',  label: 'Dataset', plural: 'Other',   icon: 'database' }
export const DEVICE_KIND = { id: 'device', label: 'Device',  plural: 'Devices', icon: 'microchip' }

export function kind_info (id) {
    if (id === 'device') return DEVICE_KIND
    return KIND_BY_ID[id] ?? OTHER_KIND
}

// Reference windows recorded from the kiosk.
export const REFERENCE_TYPES = [
    { id: 'idle',        label: 'Idle' },
    { id: 'warm-up',     label: 'Warm-up' },
    { id: 'calibration', label: 'Calibration' },
    { id: 'other',       label: 'Other' },
]

// The equipment label the energy add-on looks for.
export const ENERGY_LABEL = 'Energy'

// Carbon factors. Same method as the Decarbonisation dashboards.
export const CARBON = {
    // kgCO2e per kWh, fixed factor.
    FIXED_FACTOR: 0.21233,
    // kg per kWh added to the CO2-only grid intensity for CH4 and N2O.
    CH4_N2O: 0.05,
    // Half-hourly energy above this is treated as a bad reading.
    MAX_KWH_PER_HALF_HOUR: 500,
    // Hold the last intensity this long when the feed publishes nothing new.
    INTENSITY_HOLD_MS: 6 * 3600 * 1000,
    // Do not interpolate a register across a longer silence.
    MAX_GAP_MS: 2 * 3600 * 1000,
    // Extrapolate a register to a window edge at most this far.
    MAX_EDGE_MS: 30 * 60 * 1000,
}

// Resume is offered for this long after a kiosk Stop.
export const RESUME_WINDOW_MS = 5 * 60 * 1000
