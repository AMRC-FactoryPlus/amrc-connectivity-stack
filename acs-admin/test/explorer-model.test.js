/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * What the Explorer page works out from the i3X 1.0 model: an object's
 * kind from its type's schema, the relationship graph from named
 * edges, and what an object holds from its metadata.
 */

import { describe, expect, it } from 'vitest'

import {
  contents_of, describe_type, graph_elements, kind_of, next_layer, parent_of, role_of,
} from '../src/lib/explorer/model.js'

const types = new Map([
  ['isa95-level', { elementId: 'isa95-level', displayName: 'ISA-95 level', namespaceUri: 'urn:ns', schema: { type: 'object' } }],
  ['schema-1', { elementId: 'schema-1', displayName: 'Power Monitoring', namespaceUri: 'urn:ns', schema: { type: 'object', properties: {} } }],
  ['bare', { elementId: 'bare', displayName: 'bare', namespaceUri: 'urn:ns', schema: {} }],
  ['metric-number', { elementId: 'metric-number', displayName: 'Number metric', namespaceUri: 'urn:ns', schema: { type: 'number' } }],
  ['metric-boolean', { elementId: 'metric-boolean', displayName: 'Boolean metric', namespaceUri: 'urn:ns', schema: { type: 'boolean' } }],
  ['metric-string', { elementId: 'metric-string', displayName: 'String metric', namespaceUri: 'urn:ns', schema: { type: 'string' } }],
  ['nullable', { elementId: 'nullable', displayName: 'Nullable', namespaceUri: 'urn:ns', schema: { type: ['integer', 'null'] } }],
  ['metric', { elementId: 'metric', displayName: 'Metric', namespaceUri: 'urn:ns', schema: {} }],
])

describe('kind_of', () => {
  it('reads a data point\'s kind from its type\'s schema', () => {
    const leaf = typeElementId => ({ typeElementId, isComposition: false })
    expect(kind_of(leaf('metric-number'), types)).toBe('number')
    expect(kind_of(leaf('metric-boolean'), types)).toBe('boolean')
    expect(kind_of(leaf('metric-string'), types)).toBe('string')
    expect(kind_of(leaf('nullable'), types)).toBe('number')
    expect(kind_of(leaf('metric'), types)).toBe('value')
  })

  it('tells levels and compositions apart, whatever their type', () => {
    expect(kind_of({ typeElementId: 'isa95-level', isComposition: true }, types)).toBe('level')
    expect(kind_of({ typeElementId: 'schema-1', isComposition: true }, types)).toBe('object')
    expect(kind_of({ typeElementId: 'unknown', isComposition: true }, types)).toBe('object')
  })

  it('falls back to a plain value before the types have loaded', () => {
    expect(kind_of({ typeElementId: 'metric-number', isComposition: false }, new Map())).toBe('value')
    expect(kind_of({ typeElementId: 'metric-number', isComposition: false }, undefined)).toBe('value')
    expect(kind_of(null, types)).toBe('value')
  })
})

describe('describe_type', () => {
  it('names the type and where it comes from', () => {
    expect(describe_type({ typeElementId: 'schema-1', isComposition: true }, types)).toMatchObject({
      id: 'schema-1', name: 'Power Monitoring', namespaceUri: 'urn:ns', kind: 'object', label: 'Object',
    })
    expect(describe_type({ typeElementId: 'metric-number', isComposition: false }, types))
      .toMatchObject({ name: 'Number metric', kind: 'number', label: 'Number' })
  })

  it('has no name for a type that is unknown or named after its id', () => {
    expect(describe_type({ typeElementId: 'gone', isComposition: true }, types))
      .toMatchObject({ id: 'gone', name: null, namespaceUri: null })
    expect(describe_type({ typeElementId: 'bare', isComposition: true }, types).name).toBe(null)
  })
})

const obj = (elementId, sourceRelationship) =>
  ({ elementId, displayName: elementId.toUpperCase(), sourceRelationship })

describe('graph_elements', () => {
  it('labels each edge with the relationship and colours nodes by their role', () => {
    const { nodes, edges } = graph_elements({ elementId: 'dev', displayName: 'Device' }, [
      [{ success: true, elementId: 'dev', result: [obj('site', 'HasParent'), obj('temp', 'HasComponent'), obj('axes', 'HasComponent')] }],
    ])
    expect(nodes.map(n => [n.data.id, n.data.type])).toEqual([
      ['dev', 'selected'], ['site', 'parent'], ['temp', 'component'], ['axes', 'component'],
    ])
    expect(edges.map(e => [e.data.source, e.data.label, e.data.target])).toEqual([
      ['dev', 'HasParent', 'site'], ['dev', 'HasComponent', 'temp'], ['dev', 'HasComponent', 'axes'],
    ])
  })

  it('draws one edge for a pair, though both ends report it', () => {
    const { nodes, edges } = graph_elements({ elementId: 'site' }, [
      [{ success: true, elementId: 'site', result: [obj('dev', 'HasChildren')] }],
      [{ success: true, elementId: 'dev', result: [obj('site', 'HasParent'), obj('temp', 'HasComponent')] }],
    ])
    expect(nodes.map(n => [n.data.id, n.data.type])).toEqual([
      ['site', 'selected'], ['dev', 'child'], ['temp', 'component'],
    ])
    expect(edges.map(e => e.data.id)).toEqual(['site-dev', 'dev-temp'])
    expect(nodes[0].data.label).toBe('site')
  })

  it('skips failed lookups and results for objects not in the graph', () => {
    const { nodes, edges } = graph_elements({ elementId: 'a' }, [
      [{ success: false, elementId: 'a', responseDetail: { status: 404 } },
        { success: true, elementId: 'stray', result: [obj('x', 'HasChildren')] }],
    ])
    expect(nodes).toHaveLength(1)
    expect(edges).toEqual([])
  })
})

describe('next_layer', () => {
  it('gives each newly reached object once', () => {
    const seen = new Set(['site'])
    const layer = [
      { success: true, elementId: 'site', result: [obj('a', 'HasChildren'), obj('b', 'HasChildren')] },
      { success: true, elementId: 'other', result: [obj('a', 'HasChildren'), obj('site', 'HasParent')] },
      { success: false, elementId: 'gone' },
    ]
    expect(next_layer(layer, seen)).toEqual(['a', 'b'])
    expect(next_layer(layer, seen)).toEqual([])
  })
})

describe('role_of', () => {
  it('treats both upward relationships as a parent', () => {
    expect(['HasParent', 'ComponentOf', 'HasChildren', 'HasComponent', 'SuppliesTo', undefined].map(role_of))
      .toEqual(['parent', 'parent', 'child', 'component', 'related', 'related'])
  })
})

describe('contents_of and parent_of', () => {
  it('counts what a level and a device hold', () => {
    expect(contents_of({ relationships: { HasChildren: ['a', 'b', 'c'] } }))
      .toEqual([{ relationship: 'HasChildren', count: 3, label: '3 children' }])
    expect(contents_of({ relationships: { HasParent: 'site', HasComponent: ['t'] } }))
      .toEqual([{ relationship: 'HasComponent', count: 1, label: '1 component' }])
    expect(contents_of({ relationships: { ComponentOf: 'dev' } })).toEqual([])
    expect(contents_of(undefined)).toEqual([])
  })

  it('finds the parent by either upward relationship', () => {
    expect(parent_of({ relationships: { HasParent: 'site' } })).toBe('site')
    expect(parent_of({ relationships: { ComponentOf: 'dev' } })).toBe('dev')
    expect(parent_of({ relationships: { HasChildren: ['x'] } })).toBe(null)
    expect(parent_of(null)).toBe(null)
  })
})
