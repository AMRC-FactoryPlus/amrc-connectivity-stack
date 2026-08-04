/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Round-trip fidelity for the schema document model.
 *
 * The whole composer rests on this: any schema can be opened, navigated
 * and saved without damage. If parse then serialise is not the identity
 * for the real schema library, the model is not safe to edit with.
 */

import { describe, it, expect } from 'vitest'

import library from './fixtures/library-schemas.json'
import {
  parse,
  serialise,
  newDocument,
  newMetric,
  newGroup,
  newComponent,
  newComponentList,
  findNode,
  pathOf,
  containers,
  keyAvailable,
  referencedComponents,
  referencedSchemas,
  walk,
} from '../src/lib/schema/document.js'
import { NodeKind } from '../src/lib/schema/constants.js'

const paths = Object.keys(library)

describe('round trip over the real schema library', () => {
  it('has the library loaded', () => {
    expect(paths.length).toBeGreaterThan(100)
  })

  it.each(paths)('%s survives parse then serialise unchanged', (path) => {
    const body = library[path]
    const out = serialise(parse(body))
    /* Compared as JSON text, so property order has to match too. The
     * edge agent does not care about order but a diff in git does, and
     * an editor that silently reorders a file is not trustworthy. */
    expect(JSON.stringify(out, null, 2)).toEqual(JSON.stringify(body, null, 2))
  })

  it('round-trips every schema without throwing', () => {
    for (const path of paths) expect(() => parse(library[path])).not.toThrow()
  })
})

describe('classification of real schemas', () => {
  const kindsIn = (path) => {
    const kinds = new Set()
    walk(parse(library[path]), n => kinds.add(n.kind))
    return kinds
  }

  it('recognises metrics in a device schema', () => {
    expect(kindsIn('CNC/Spindle-v1.yaml')).toContain(NodeKind.METRIC)
  })

  it('recognises component lists in the CNC schema', () => {
    const doc = parse(library['CNC/CNC-v1.yaml'])
    const axes = doc.children.find(n => n.key === 'Axes')
    expect(axes.kind).toEqual(NodeKind.COMPONENT_LIST)
    expect(axes.ref).toEqual('e39007e9-1427-4867-9d72-1c00c663db15')
  })

  it('recognises a plain component reference', () => {
    const doc = parse(library['CNC/CNC-v1.yaml'])
    const info = doc.children.find(n => n.key === 'Device_Information')
    expect(info.kind).toEqual(NodeKind.COMPONENT)
    expect(info.ref).toEqual('0f9f3955-a8fa-467f-b288-c39ff3fa75f1')
  })

  it('marks Schema_UUID and Instance_UUID reserved', () => {
    const doc = parse(library['CNC/CNC-v1.yaml'])
    const reserved = doc.children
      .filter(n => n.kind === NodeKind.RESERVED)
      .map(n => n.key)
    expect(reserved).toEqual(['Schema_UUID', 'Instance_UUID'])
  })

  it('reads metric constraints even when the block carries extra keys', () => {
    /* Device_Information writes `type: object` inside the constraint
     * block; Spindle does not. Both must read the same. */
    const doc = parse(library['Common/Device_Information-v1.yaml'])
    const manufacturer = doc.children.find(n => n.key === 'Manufacturer')
    expect(manufacturer.kind).toEqual(NodeKind.METRIC)
    expect(manufacturer.fields.Sparkplug_Type).toEqual(['String'])
    expect(manufacturer.fields.Documentation).toMatch(/manufacturer/i)
  })

  it('never produces a node it cannot name', () => {
    for (const path of paths)
      walk(parse(library[path]), (node) => {
        expect(Object.values(NodeKind)).toContain(node.kind)
      })
  })
})

describe('opaque nodes', () => {
  const odd = {
    $id: 'urn:uuid:11111111-1111-1111-1111-111111111111',
    type: 'object',
    properties: {
      Schema_UUID: { const: '11111111-1111-1111-1111-111111111111' },
      Weird: { oneOf: [{ type: 'string' }, { type: 'number' }], deprecated: true },
    },
  }

  it('holds an unrecognised property as opaque', () => {
    const doc = parse(odd)
    const weird = doc.children.find(n => n.key === 'Weird')
    expect(weird.kind).toEqual(NodeKind.OPAQUE)
  })

  it('round-trips it untouched', () => {
    expect(serialise(parse(odd))).toEqual(odd)
  })

  it('round-trips it after unrelated edits elsewhere', () => {
    const doc = parse(odd)
    doc.children.push(newMetric('Added'))
    const out = serialise(doc)
    expect(out.properties.Weird).toEqual(odd.properties.Weird)
  })
})

describe('editing', () => {
  const uuid = '22222222-2222-2222-2222-222222222222'

  it('creates a valid new document', () => {
    const doc = newDocument(uuid, 'Test Machine')
    const body = serialise(doc)
    expect(body.$id).toEqual(`urn:uuid:${uuid}`)
    expect(body.properties.Schema_UUID.const).toEqual(uuid)
    expect(body.title).toEqual('Test Machine')
  })

  it('keeps $id and Schema_UUID in step, which the git loader requires', () => {
    const doc = newDocument(uuid, 'Test')
    doc.uuid = '33333333-3333-3333-3333-333333333333'
    const body = serialise(doc)
    expect(body.$id).toEqual(`urn:uuid:${body.properties.Schema_UUID.const}`)
  })

  it('adds a metric with the fields the composer manages', () => {
    const doc = newDocument(uuid, 'Test')
    const metric = newMetric('Speed')
    metric.fields.Sparkplug_Type = ['DoubleLE']
    metric.fields.Eng_Unit = 'mm/min'
    metric.fields.Documentation = 'Spindle speed'
    doc.children.push(metric)

    const out = serialise(doc).properties.Speed
    const constraint = out.allOf[1].properties
    expect(constraint.Sparkplug_Type.enum).toEqual(['DoubleLE'])
    expect(constraint.Eng_Unit.default).toEqual('mm/min')
    expect(constraint.Documentation.default).toEqual('Spindle speed')
  })

  it('removes a metric field entirely when it is deleted', () => {
    const doc = newDocument(uuid, 'Test')
    const metric = newMetric('Speed')
    metric.fields.Eng_Unit = 'mm'
    doc.children.push(metric)
    expect(serialise(doc).properties.Speed.allOf[1].properties.Eng_Unit)
      .toBeDefined()

    delete metric.fields.Eng_Unit
    expect(serialise(doc).properties.Speed.allOf[1].properties.Eng_Unit)
      .toBeUndefined()
  })

  it('keeps an empty string or an explicit null, which the library uses', () => {
    const doc = newDocument(uuid, 'Test')
    const metric = newMetric('Speed')
    metric.fields.Documentation = ''
    metric.fields.Eng_Unit = null
    doc.children.push(metric)

    const props = serialise(doc).properties.Speed.allOf[1].properties
    expect(props.Documentation.default).toEqual('')
    expect(props.Eng_Unit.default).toBeNull()
  })

  it('nests groups and serialises them as objects', () => {
    const doc = newDocument(uuid, 'Test')
    const group = newGroup('Motors')
    group.children.push(newMetric('Current'))
    doc.children.push(group)

    const out = serialise(doc).properties.Motors
    expect(out.type).toEqual('object')
    expect(out.properties.Current.allOf).toBeDefined()
  })

  it('serialises components and component lists', () => {
    const target = '44444444-4444-4444-4444-444444444444'
    const doc = newDocument(uuid, 'Test')
    doc.children.push(newComponent('Info', target))
    doc.children.push(newComponentList('Axes', target))

    const out = serialise(doc).properties
    expect(out.Info.$ref).toEqual(`urn:uuid:${target}`)
    expect(out.Axes.patternProperties['^[a-zA-Z0-9_]*$'].$ref)
      .toEqual(`urn:uuid:${target}`)
  })

  it('preserves extra keys on a component list when the target changes', () => {
    /* CNC/Channels carries a $comment beside its $ref. */
    const doc = parse(library['CNC/CNC-v1.yaml'])
    const channels = doc.children.find(n => n.key === 'Channels')
    channels.ref = '55555555-5555-5555-5555-555555555555'

    const inner = serialise(doc).properties.Channels
      .patternProperties['^[a-zA-Z0-9_]*$']
    expect(inner.$comment).toBeDefined()
    expect(inner.$ref).toEqual('urn:uuid:55555555-5555-5555-5555-555555555555')
  })

  it('reordering children changes only the emitted order', () => {
    const doc = parse(library['CNC/Spindle-v1.yaml'])
    const before = Object.keys(serialise(doc).properties)
    const moved = doc.children.pop()
    doc.children.splice(2, 0, moved)
    const after = Object.keys(serialise(doc).properties)

    expect(after).not.toEqual(before)
    expect([...after].sort()).toEqual([...before].sort())
  })
})

describe('navigation helpers', () => {
  it('finds a node and its container', () => {
    const doc = newDocument('66666666-6666-6666-6666-666666666666', 'T')
    const group = newGroup('Motors')
    const metric = newMetric('Current')
    group.children.push(metric)
    doc.children.push(group)

    const found = findNode(doc, metric.id)
    expect(found.node.key).toEqual('Current')
    expect(found.container.key).toEqual('Motors')
    expect(pathOf(doc, metric.id)).toEqual(['Motors', 'Current'])
  })

  it('lists containers including the document root', () => {
    const doc = newDocument('77777777-7777-7777-7777-777777777777', 'T')
    const group = newGroup('Motors')
    group.children.push(newGroup('Left'))
    doc.children.push(group)

    expect(containers(doc).map(c => c.path))
      .toEqual([[], ['Motors'], ['Motors', 'Left']])
  })

  it('refuses reserved and duplicate keys', () => {
    const doc = newDocument('88888888-8888-8888-8888-888888888888', 'T')
    doc.children.push(newMetric('Speed'))

    expect(keyAvailable(doc, 'Speed')).toBe(false)
    expect(keyAvailable(doc, 'Schema_UUID')).toBe(false)
    expect(keyAvailable(doc, 'Torque')).toBe(true)
  })

  it('collects every referenced schema', () => {
    const refs = referencedSchemas(parse(library['CNC/CNC-v1.yaml']))
    expect(refs).toContain('0f9f3955-a8fa-467f-b288-c39ff3fa75f1')
    expect(refs).toContain('71df1162-40ca-4d19-bacc-95dea227d98b')
    expect(refs.size).toEqual(4)
  })

  it('counts the metric contract as a reference', () => {
    /* Spindle is all metrics and no components, so its only dependency
     * is the metric schema itself. Missing that would report zero
     * affected schemas if Common/Metric were ever forked. */
    const refs = referencedSchemas(parse(library['CNC/Spindle-v1.yaml']))
    expect(refs).toContain('b16275f1-e443-4c41-a482-fcbdfbd20769')
  })

  it('separates component references from the metric contract', () => {
    const doc = parse(library['CNC/Spindle-v1.yaml'])
    const components = referencedComponents(doc)
    const all = referencedSchemas(doc)
    const metric = 'b16275f1-e443-4c41-a482-fcbdfbd20769'

    expect(components).not.toContain(metric)
    expect(all).toContain(metric)
    /* The full set is the components plus the metric contract. */
    expect(all.size).toEqual(components.size + 1)
    for (const ref of components) expect(all).toContain(ref)
  })
})

describe('top-level flag', () => {
  const uuid = '99999999-9999-9999-9999-999999999999'

  it('reads the flag when a schema sets it', () => {
    const doc = parse({
      $id: `urn:uuid:${uuid}`,
      topLevel: true,
      type: 'object',
      properties: { Schema_UUID: { const: uuid } },
    })
    expect(doc.topLevel).toBe(true)
  })

  it('reads false when a schema declares itself a component', () => {
    const doc = parse({
      $id: `urn:uuid:${uuid}`,
      topLevel: false,
      type: 'object',
      properties: { Schema_UUID: { const: uuid } },
    })
    expect(doc.topLevel).toBe(false)
  })

  /* Undefined is not false. A library that predates the flag says
   * nothing, and the picker treats that differently from a schema that
   * has declared itself a component. */
  it('is undefined when the schema says nothing', () => {
    expect(parse(library['CNC/CNC-v1.yaml']).topLevel).toBeUndefined()
  })

  it('leaves the key off entirely when undefined', () => {
    const body = serialise(parse(library['CNC/CNC-v1.yaml']))
    expect('topLevel' in body).toBe(false)
  })

  it('writes the key once set', () => {
    const doc = parse(library['CNC/CNC-v1.yaml'])
    doc.topLevel = true
    expect(serialise(doc).topLevel).toBe(true)
  })

  it('writes false when a schema is marked as a component', () => {
    const doc = parse(library['CNC/Axis-v1.yaml'])
    doc.topLevel = false
    expect(serialise(doc).topLevel).toBe(false)
  })

  it('round-trips a schema that already carries the flag', () => {
    const body = {
      $id: `urn:uuid:${uuid}`,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Marked',
      topLevel: true,
      type: 'object',
      properties: { Schema_UUID: { const: uuid } },
      required: ['Schema_UUID'],
    }
    expect(JSON.stringify(serialise(parse(body)), null, 2))
      .toEqual(JSON.stringify(body, null, 2))
  })

  it('marks a newly authored schema as top-level', () => {
    /* Someone sitting down to author a schema is usually describing a
     * machine, not a part of one. */
    expect(serialise(newDocument(uuid, 'New')).topLevel).toBe(true)
  })
})
