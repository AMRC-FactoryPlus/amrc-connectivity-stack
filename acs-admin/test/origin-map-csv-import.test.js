/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * CSV import regression tests: slash-containing metric names must
 * round-trip, created levels must carry Schema_UUID/Instance_UUID
 * markers, and '<new>' placeholder rows must never become instances.
 */

import { describe, it, expect, vi } from 'vitest';

/* The composable imports only ISA95_HIERARCHY_KEY from the store, but
 * the store drags in the whole service-client stack; mock it away. */
vi.mock('@/store/useISA95Store.js', () => ({
    ISA95_HIERARCHY_KEY: 'ISA95_Hierarchy',
}));

import { applyCsvToModel } from '@/composables/useOriginMapCsv.js';

const METRIC = (typeDefault = 'String') => ({
    allOf: [
        { properties: {
            Schema_UUID: { const: 'metric-schema-uuid' },
            Sparkplug_Type: { default: typeDefault },
        } },
        { properties: {
            Method: { enum: ['GET', 'REST'] },
        } },
    ],
});

/* A device schema with a plain folder holding a slash-named metric, a
 * nested group with its own Schema_UUID, and a schema array. */
const SCHEMA = {
    properties: {
        Schema_UUID: { const: 'device-schema' },
        Player_Controls: {
            properties: {
                Schema_UUID: { const: 'player-controls-schema' },
                'Player/Load': METRIC(),
                Load: METRIC(),
            },
        },
        Axes: {
            type: 'object',
            patternProperties: {
                '^[A-Z]$': {
                    properties: {
                        Schema_UUID: { const: 'axis-schema' },
                        Base_Axis: {
                            properties: {
                                Schema_UUID: { const: 'base-axis-schema' },
                                Load: METRIC('FloatLE'),
                            },
                        },
                    },
                },
            },
        },
    },
};

const row = (tagPath, fields = {}) => ({ tagPath, fields });

describe('applyCsvToModel', () => {
    it('resolves metric names that contain slashes by longest prefix match', () => {
        const model = {};
        const res = applyCsvToModel([
            row('Player_Controls/Player/Load', { Address: 'player:load' }),
        ], model, SCHEMA);

        expect(res.applied).toBe(1);
        expect(res.skipped).toBe(0);
        expect(model.Player_Controls['Player/Load'].Address).toBe('player:load');
        /* It must not have created nested Player.Load objects */
        expect(model.Player_Controls.Player).toBeUndefined();
    });

    it('prefers the longest matching key when both could match', () => {
        const model = {};
        applyCsvToModel([
            row('Player_Controls/Load', { Address: 'player:load' }),
        ], model, SCHEMA);
        expect(model.Player_Controls.Load.Address).toBe('player:load');
    });

    it('stamps Schema_UUID and Instance_UUID on every created level', () => {
        const model = {};
        const res = applyCsvToModel([
            row('Axes/X/Base_Axis/Load', { Address: 'Axes/X/Base_Axis/Load' }),
        ], model, SCHEMA);

        expect(res.applied).toBe(1);
        const x = model.Axes.X;
        expect(x.Schema_UUID).toBe('axis-schema');
        expect(x.Instance_UUID).toMatch(/^[0-9a-f-]{36}$/);
        expect(x.Base_Axis.Schema_UUID).toBe('base-axis-schema');
        expect(x.Base_Axis.Instance_UUID).toMatch(/^[0-9a-f-]{36}$/);
        expect(x.Base_Axis.Load.Schema_UUID).toBe('metric-schema-uuid');
    });

    it('heals existing levels that lack their markers', () => {
        const model = { Axes: { X: { Base_Axis: {} } } };
        applyCsvToModel([
            row('Axes/X/Base_Axis/Load', { Address: 'a' }),
        ], model, SCHEMA);
        expect(model.Axes.X.Schema_UUID).toBe('axis-schema');
        expect(model.Axes.X.Instance_UUID).toBeDefined();
        expect(model.Axes.X.Base_Axis.Schema_UUID).toBe('base-axis-schema');
    });

    it('keeps existing markers instead of re-minting them', () => {
        const model = { Axes: { X: {
            Schema_UUID: 'axis-schema', Instance_UUID: 'keep-me',
        } } };
        applyCsvToModel([
            row('Axes/X/Base_Axis/Load', { Address: 'a' }),
        ], model, SCHEMA);
        expect(model.Axes.X.Instance_UUID).toBe('keep-me');
    });

    it('skips <new> placeholder rows instead of creating phantom instances', () => {
        const model = {};
        const res = applyCsvToModel([
            row('Axes/<new>/Base_Axis/Load', { Address: 'a' }),
        ], model, SCHEMA);
        expect(res.placeholders).toBe(1);
        expect(res.applied).toBe(0);
        expect(model.Axes).toBeUndefined();
    });

    it('still counts genuinely unknown paths as skipped', () => {
        const model = {};
        const res = applyCsvToModel([
            row('Nonsense/Path', { Address: 'a' }),
        ], model, SCHEMA);
        expect(res.skipped).toBe(1);
        expect(res.applied).toBe(0);
    });
});
