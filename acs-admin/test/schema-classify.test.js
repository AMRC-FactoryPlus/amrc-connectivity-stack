/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The change classifier decides whether an edit can update a schema in
 * place or has to fork it to a new version. Getting a breaking change
 * wrong the safe way costs a needless version; getting it wrong the
 * unsafe way silently breaks a running device. These tests pin the table.
 */

import { describe, it, expect } from 'vitest'

import library from './fixtures/library-schemas.json'
import { classify, hasChanges, ChangeKind } from '../src/lib/schema/classify.js'
import {
  parse,
  serialise,
  newMetric,
  newGroup,
  newComponent,
  newComponentList,
} from '../src/lib/schema/document.js'

const SPINDLE = 'CNC/Spindle-v1.yaml'
const CNC = 'CNC/CNC-v1.yaml'

/** Edit a library schema through the model and return the new body. */
const edit = (path, fn) => {
  const doc = parse(library[path])
  fn(doc)
  return serialise(doc)
}

const summaries = result => result.changes.map(c => c.summary)

describe('no change', () => {
  it('reports nothing for an untouched schema', () => {
    const result = classify(library[SPINDLE], library[SPINDLE])
    expect(result.changes).toEqual([])
    expect(result.breaking).toBe(false)
    expect(result.additive).toBe(false)
  })

  it('reports no change through a parse and serialise cycle', () => {
    const body = serialise(parse(library[CNC]))
    expect(classify(library[CNC], body).changes).toEqual([])
    expect(hasChanges(library[CNC], body)).toBe(false)
  })

  it('treats reordering as presentation, not as a change', () => {
    const after = edit(SPINDLE, doc => {
      const moved = doc.children.pop()
      doc.children.splice(2, 0, moved)
    })
    const result = classify(library[SPINDLE], after)
    expect(result.changes).toEqual([])
    expect(result.breaking).toBe(false)
  })
})

describe('additive changes', () => {
  it('adding a metric is additive', () => {
    const after = edit(SPINDLE, doc => doc.children.push(newMetric('Coolant_Temp')))
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(false)
    expect(result.additive).toBe(true)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].kind).toEqual(ChangeKind.ADDED)
    expect(result.changes[0].summary).toEqual('Coolant_Temp added')
  })

  it('adding a group is additive', () => {
    const after = edit(SPINDLE, doc => doc.children.push(newGroup('Diagnostics')))
    expect(classify(library[SPINDLE], after).breaking).toBe(false)
  })

  it('adding a component is additive', () => {
    const after = edit(SPINDLE, doc =>
      doc.children.push(newComponent('Extra', '00000000-0000-0000-0000-000000000001')))
    expect(classify(library[SPINDLE], after).breaking).toBe(false)
  })

  it('adding a nested metric inside an existing group is additive', () => {
    const base = edit(SPINDLE, doc => {
      const group = newGroup('Diagnostics')
      doc.children.push(group)
    })
    const after = edit(SPINDLE, doc => {
      const group = newGroup('Diagnostics')
      group.children.push(newMetric('Vibration'))
      doc.children.push(group)
    })
    const result = classify(base, after)

    expect(result.breaking).toBe(false)
    expect(summaries(result)).toEqual(['Diagnostics / Vibration added'])
  })

  it('changing documentation is additive', () => {
    const after = edit(SPINDLE, doc => {
      doc.children.find(n => n.key === 'Act_Load').fields.Documentation = 'New text'
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(false)
    expect(summaries(result)).toEqual(['Act_Load: Documentation changed'])
  })

  it('changing unit and range is additive', () => {
    const after = edit(SPINDLE, doc => {
      const node = doc.children.find(n => n.key === 'Act_Load')
      node.fields.Eng_Unit = '%'
      node.fields.Eng_Low = 0
      node.fields.Eng_High = 100
    })
    expect(classify(library[SPINDLE], after).breaking).toBe(false)
  })

  it('widening the allowed Sparkplug types is additive', () => {
    const after = edit(SPINDLE, doc => {
      const node = doc.children.find(n => n.key === 'Act_Load')
      node.fields.Sparkplug_Type = [...node.fields.Sparkplug_Type, 'FloatLE']
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(false)
    expect(summaries(result)).toEqual(['Act_Load: also accepts FloatLE'])
  })

  it('dropping a requirement is additive', () => {
    const after = edit(SPINDLE, doc => {
      doc.raw.required = ['Schema_UUID']
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(false)
    expect(summaries(result)).toEqual(['Instance_UUID no longer required'])
  })

  it('changing the title is additive', () => {
    const after = edit(SPINDLE, doc => { doc.title = 'CNC Spindle (Sheffield)' })
    expect(classify(library[SPINDLE], after).breaking).toBe(false)
  })
})

describe('breaking changes', () => {
  it('removing a metric is breaking', () => {
    const after = edit(SPINDLE, doc => {
      doc.children = doc.children.filter(n => n.key !== 'Act_Load')
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(result.changes[0].kind).toEqual(ChangeKind.REMOVED)
    expect(result.changes[0].summary).toEqual('Act_Load removed')
  })

  it('renaming a metric is breaking, and reported as a rename', () => {
    const after = edit(SPINDLE, doc => {
      doc.children.find(n => n.key === 'Act_Load').key = 'Actual_Load'
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].kind).toEqual(ChangeKind.RENAMED)
    expect(result.changes[0].summary).toEqual('Act_Load renamed to Actual_Load')
    expect(result.changes[0].from).toEqual('Act_Load')
    expect(result.changes[0].to).toEqual('Actual_Load')
  })

  it('narrowing the allowed Sparkplug types is breaking', () => {
    const after = edit(SPINDLE, doc => {
      doc.children.find(n => n.key === 'Act_Load').fields.Sparkplug_Type = ['DoubleLE']
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(summaries(result)).toEqual(['Act_Load: no longer accepts DoubleBE'])
  })

  it('reports narrowing and widening separately in one edit', () => {
    const after = edit(SPINDLE, doc => {
      doc.children.find(n => n.key === 'Act_Load').fields.Sparkplug_Type = ['FloatLE']
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(summaries(result)).toContain('Act_Load: no longer accepts DoubleLE, DoubleBE')
    expect(summaries(result)).toContain('Act_Load: also accepts FloatLE')
  })

  it('pointing a component at a different schema is breaking', () => {
    const after = edit(CNC, doc => {
      doc.children.find(n => n.key === 'Device_Information').ref =
        '00000000-0000-0000-0000-000000000002'
    })
    const result = classify(library[CNC], after)

    expect(result.breaking).toBe(true)
    expect(summaries(result))
      .toEqual(['Device_Information: now uses a different component'])
  })

  it('pointing a component list at a different schema is breaking', () => {
    const after = edit(CNC, doc => {
      doc.children.find(n => n.key === 'Axes').ref =
        '00000000-0000-0000-0000-000000000003'
    })
    expect(classify(library[CNC], after).breaking).toBe(true)
  })

  it('changing a component list naming pattern is breaking', () => {
    const after = edit(CNC, doc => {
      doc.children.find(n => n.key === 'Axes').pattern = '^[0-9]+$'
    })
    const result = classify(library[CNC], after)

    expect(result.breaking).toBe(true)
    expect(summaries(result)).toEqual(['Axes: naming pattern changed'])
  })

  it('adding a requirement is breaking', () => {
    const after = edit(SPINDLE, doc => {
      doc.raw.required = [...doc.raw.required, 'Act_Load']
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(summaries(result)).toEqual(['Act_Load now required'])
  })

  it('changing a node from one kind to another is breaking', () => {
    const after = edit(SPINDLE, doc => {
      const index = doc.children.findIndex(n => n.key === 'Act_Load')
      doc.children[index] = newGroup('Act_Load')
    })
    const result = classify(library[SPINDLE], after)

    expect(result.breaking).toBe(true)
    expect(result.changes[0].kind).toEqual(ChangeKind.RETYPED)
    expect(result.changes[0].summary)
      .toEqual('Act_Load: changed from a metric to a group')
  })

  it('removing a group takes its contents with it, and is breaking', () => {
    const base = edit(SPINDLE, doc => {
      const group = newGroup('Diagnostics')
      group.children.push(newMetric('Vibration'))
      doc.children.push(group)
    })
    const result = classify(base, library[SPINDLE])

    expect(result.breaking).toBe(true)
    expect(summaries(result)).toEqual(['Diagnostics removed'])
  })
})

describe('opaque nodes', () => {
  const base = {
    $id: 'urn:uuid:11111111-1111-1111-1111-111111111111',
    type: 'object',
    properties: {
      Schema_UUID: { const: '11111111-1111-1111-1111-111111111111' },
      Weird: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    },
  }

  it('treats any change to an opaque node as breaking without analysing it', () => {
    const after = JSON.parse(JSON.stringify(base))
    after.properties.Weird.oneOf.push({ type: 'boolean' })

    const result = classify(base, after)
    expect(result.breaking).toBe(true)
    expect(summaries(result)).toEqual(['Weird: changed'])
  })

  it('leaves an untouched opaque node out of the change list', () => {
    const after = JSON.parse(JSON.stringify(base))
    after.properties.Added = { allOf: [{ $ref: 'urn:uuid:b16275f1-e443-4c41-a482-fcbdfbd20769' }] }

    const result = classify(base, after)
    expect(result.breaking).toBe(false)
    expect(summaries(result)).toEqual(['Added added'])
  })

  it('treats a change to a reserved property as breaking', () => {
    const after = JSON.parse(JSON.stringify(base))
    after.properties.Schema_UUID.const = '99999999-9999-9999-9999-999999999999'

    expect(classify(base, after).breaking).toBe(true)
  })
})

describe('metric changes outside the editable fields', () => {
  it('is breaking when the untracked part of a metric changes', () => {
    const before = parse(library[SPINDLE])
    const after = parse(library[SPINDLE])
    const node = after.children.find(n => n.key === 'Act_Load')
    /* Something the composer does not manage: a second constraint
     * member appended to the allOf. */
    node.raw.allOf.push({ readOnly: true })

    const result = classify(serialise(before), serialise(after))
    expect(result.breaking).toBe(true)
    expect(summaries(result))
      .toContain('Act_Load: changed outside the editable fields')
  })
})

describe('every library schema is stable against itself', () => {
  it.each(Object.keys(library))('%s reports no change against itself', (path) => {
    expect(classify(library[path], library[path]).changes).toEqual([])
  })
})
