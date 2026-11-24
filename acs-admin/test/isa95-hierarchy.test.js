/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The ISA-95 hierarchy page: the tree rows, device counts, the
 * duplicate check and the writes behind add, rename and move.
 */

import { describe, it, expect } from 'vitest'

import { UUIDs } from '@amrc-factoryplus/service-client'

import {
  abbreviation, add_alias, all_branch_keys, create_node, device_counts,
  duplicate_flags, fold_name, highlight, move_targets, name_match,
  node_path, plan_move, similar_nodes, tree_rows,
} from '../src/lib/isa95-hierarchy.js'
import { vocabulary_of } from '../src/lib/isa95-placement.js'

const node = (uuid, name, level, children = [], aliases = []) =>
  ({ uuid, name, level, children, aliases })

/* Two Sites for one place (site and dup), and a Work Center under two
 * Areas (wc2 under area1 and area2). */
const NODES = [
  node('ent', 'Acme', 'Enterprise', ['site', 'dup', 'ktc']),
  node('site', 'Plant 7', 'Site', ['area1', 'area2']),
  node('dup', 'P7', 'Site', [], ['Plant7']),
  node('ktc', 'Knowledge Transfer Centre', 'Site', []),
  node('area1', 'Machining', 'Area', ['wc1', 'wc2']),
  node('area2', 'Composites', 'Area', ['wc2']),
  node('wc1', 'Cell 1', 'Work Center', ['wu1']),
  node('wc2', 'Metrology Lab', 'Work Center', []),
  node('wu1', 'Robot 1', 'Work Unit', []),
  node('ent2', 'Other Co', 'Enterprise', ['site2']),
  node('site2', 'Plant', 'Site', ['area3']),
  node('area3', 'Machining', 'Area', ['wc3']),
  node('wc3', 'Cell 1', 'Work Center', []),
  /* No parent, so it must still show at the top. */
  node('orphan', 'Lost Area', 'Area', []),
]
const vocab = () => vocabulary_of(NODES)

const PLACEMENTS = new Map([
  ['d1', { node: 'wu1' }],
  ['d2', { node: 'wc1' }],
  ['d3', { node: 'wc2' }],
  ['d4', { node: 'dup' }],
  ['d5', { node: 'nowhere' }],
  ['d6', {}],
])

describe('device counts', () => {
  it('counts devices on a node and at or below it', () => {
    const c = device_counts(vocab(), PLACEMENTS)
    expect(c.get('wu1')).toEqual({ here: 1, total: 1 })
    expect(c.get('wc1')).toEqual({ here: 1, total: 2 })
    expect(c.get('area1')).toEqual({ here: 0, total: 3 })
    expect(c.get('ent2')).toEqual({ here: 0, total: 0 })
  })

  it('counts a device under two parents once above both', () => {
    const c = device_counts(vocab(), PLACEMENTS)
    expect(c.get('area2').total).toBe(1)
    /* d1, d2, d3: d3 reaches the Site through both Areas. */
    expect(c.get('site').total).toBe(3)
    expect(c.get('ent').total).toBe(4)
  })

  it('ignores devices with no placement or a missing node', () => {
    const c = device_counts(vocab(), PLACEMENTS)
    const sum = [...c.values()].reduce((s, x) => s + x.here, 0)
    expect(sum).toBe(4)
  })
})

describe('comparing names', () => {
  it('folds case, spaces and punctuation', () => {
    expect(fold_name('P-7 ')).toBe('p7')
    expect(fold_name('Plant 7')).toBe('plant7')
  })

  it('abbreviates words and keeps numbers whole', () => {
    expect(abbreviation('Plant 7')).toBe('p7')
    expect(abbreviation('Knowledge Transfer Centre')).toBe('ktc')
    expect(abbreviation('Machining')).toBe(null)
  })

  it('gives the strongest reason first', () => {
    const v = vocab()
    expect(name_match('plant 7', v.nodes.get('site')).why).toBe('same name')
    expect(name_match('P-7', v.nodes.get('dup')).why).toBe('same name, ignoring punctuation')
    expect(name_match('Plant-7', v.nodes.get('dup')).why).toBe('alias "Plant7"')
    expect(name_match('P-7', v.nodes.get('site')).why).toBe('abbreviation of "Plant 7"')
    expect(name_match('KTC', v.nodes.get('ktc')).why).toBe('abbreviation of "Knowledge Transfer Centre"')
    expect(name_match('Machinning', v.nodes.get('area1')).why).toBe('similar name')
  })

  it('marks containment as a weak match', () => {
    const m = name_match('Cell 10', vocabulary_of([node('x', 'Cell 1', 'Work Center')]).nodes.get('x'))
    expect(m).toEqual({ why: 'contains "Cell 1"', strong: false })
  })

  it('treats names with different numbers as different', () => {
    const v = vocabulary_of([node('x', 'Cell 1', 'Work Center')])
    expect(name_match('Cell 2', v.nodes.get('x'))).toBe(null)
    expect(name_match('Cel 1', v.nodes.get('x')).why).toBe('similar name')
  })

  it('keeps names two letters apart separate unless they are long', () => {
    const v = vocabulary_of([
      node('n', 'North Works', 'Site'),
      node('k', 'Knowledge Transfer Centre', 'Site'),
    ])
    expect(name_match('South Works', v.nodes.get('n'))).toBe(null)
    expect(name_match('Knowledge Transfer Center', v.nodes.get('k')).why).toBe('similar name')
  })

  it('does not match short or unrelated names', () => {
    const v = vocab()
    expect(name_match('Turning', v.nodes.get('area1'))).toBe(null)
    expect(name_match('A', v.nodes.get('area1'))).toBe(null)
    expect(name_match('  ', v.nodes.get('area1'))).toBe(null)
  })
})

describe('the duplicate check', () => {
  it('looks across the whole hierarchy at one level', () => {
    const counts = device_counts(vocab(), PLACEMENTS)
    const m = similar_nodes(vocab(), { level: 'Site', name: 'P-7', counts })
    expect(m.map(x => x.uuid)).toEqual(['site', 'dup'])
    expect(m[0]).toMatchObject({ name: 'Plant 7', path: 'Acme', devices: 3 })
  })

  it('finds same-named nodes under other parents', () => {
    const m = similar_nodes(vocab(), { level: 'Area', name: 'Machining' })
    expect(m.map(x => x.path).sort()).toEqual(['Acme / Plant 7', 'Other Co / Plant'])
  })

  it('leaves out the node being renamed and other levels', () => {
    const m = similar_nodes(vocab(), { level: 'Site', name: 'P7', exclude: 'dup' })
    expect(m.map(x => x.uuid)).toEqual(['site'])
    expect(similar_nodes(vocab(), { level: 'Area', name: 'P7' })).toEqual([])
  })

  it('flags the sibling with fewer devices in the tree', () => {
    const counts = device_counts(vocab(), PLACEMENTS)
    const flags = duplicate_flags(vocab(), counts)
    expect(flags.get('dup')).toBe('site')
    expect(flags.has('site')).toBe(false)
  })

  it('does not flag same names under different parents', () => {
    const flags = duplicate_flags(vocab(), device_counts(vocab(), []))
    expect(flags.has('area3')).toBe(false)
    expect(flags.has('wc3')).toBe(false)
  })

  it('flags both siblings when their counts are equal', () => {
    const flags = duplicate_flags(vocab(), device_counts(vocab(), []))
    expect(flags.get('dup')).toBe('site')
    expect(flags.get('site')).toBe('dup')
  })
})

describe('the tree rows', () => {
  it('shows only the top level when nothing is open', () => {
    const rows = tree_rows(vocab(), { open: new Set() })
    expect(rows.map(r => r.uuid)).toEqual(['ent', 'ent2', 'orphan'])
    expect(rows[0]).toMatchObject({ depth: 0, hasKids: true, expanded: false })
  })

  it('shows a node under each of its parents', () => {
    const rows = tree_rows(vocab(), { open: all_branch_keys(vocab()) })
    const wc2 = rows.filter(r => r.uuid === 'wc2')
    expect(wc2.map(r => r.parent).sort()).toEqual(['area1', 'area2'])
    expect(wc2.find(r => r.parent === 'area1').also).toEqual(['Composites'])
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
  })

  it('sorts children by name', () => {
    const rows = tree_rows(vocab(), { open: new Set(['ent']) })
    expect(rows.filter(r => r.depth === 1).map(r => r.uuid)).toEqual(['ktc', 'dup', 'site'])
  })

  it('keeps the ancestors of a search match open', () => {
    const rows = tree_rows(vocab(), { query: 'robot' })
    expect(rows.map(r => r.uuid)).toEqual(['ent', 'site', 'area1', 'wc1', 'wu1'])
  })

  it('searches aliases too', () => {
    const rows = tree_rows(vocab(), { query: 'plant7' })
    expect(rows.map(r => r.uuid)).toContain('dup')
  })

  it('splits a name for highlighting', () => {
    expect(highlight('Metrology Lab', 'lab')).toEqual({ pre: 'Metrology ', mid: 'Lab', post: '' })
    expect(highlight('Metrology Lab', 'x')).toBe(null)
  })

  it('gives a node\'s path', () => {
    expect(node_path(vocab(), 'wu1')).toEqual(['Acme', 'Plant 7', 'Machining', 'Cell 1', 'Robot 1'])
  })
})

describe('moving a node', () => {
  it('offers every node one level up and marks current parents', () => {
    const t = move_targets(vocab(), 'wc2')
    /* The orphan has no path, so it sorts first. */
    expect(t.map(x => x.uuid)).toEqual(['orphan', 'area2', 'area1', 'area3'])
    expect(t.filter(x => x.current).map(x => x.uuid).sort()).toEqual(['area1', 'area2'])
  })

  it('offers nothing for an Enterprise', () => {
    expect(move_targets(vocab(), 'ent')).toEqual([])
  })

  it('replaces one parent and keeps the other', () => {
    const { steps } = plan_move(vocab(), 'wc2', 'area1', 'area3')
    expect(steps).toEqual([
      { vocabulary: 'area3', config: { aliases: [], children: ['wc3', 'wc2'] } },
      { vocabulary: 'area1', config: { aliases: [], children: ['wc1'] } },
    ])
  })

  it('refuses the wrong level', () => {
    expect(plan_move(vocab(), 'wc2', 'area1', 'site').error).toMatch(/only go under an Area/)
  })

  it('does nothing when the parent is the same', () => {
    expect(plan_move(vocab(), 'wc1', 'area1', 'area1')).toEqual({ steps: [] })
  })
})

describe('writing nodes', () => {
  const recorder = () => {
    const calls = []
    return {
      calls,
      create_object: async (cls) => { calls.push(['create', cls]); return 'new' },
      put_config: async (app, obj, conf) => { calls.push(['put', app, obj, conf]) },
    }
  }

  it('creates a node, then links it under its parent', async () => {
    const cdb = recorder()
    const uuid = await create_node(cdb, vocab(), {
      level: 'Area', name: ' Turning ', parent: 'site', class_uuid: 'class-area',
    })
    expect(uuid).toBe('new')
    expect(cdb.calls).toEqual([
      ['create', 'class-area'],
      ['put', UUIDs.App.Info, 'new', { name: 'Turning' }],
      ['put', UUIDs.App.ISA95Vocabulary, 'new', { aliases: [], children: [] }],
      ['put', UUIDs.App.ISA95Vocabulary, 'site', { aliases: [], children: ['area1', 'area2', 'new'] }],
    ])
  })

  it('refuses a child at the wrong level before writing', async () => {
    const cdb = recorder()
    await expect(create_node(cdb, vocab(), {
      level: 'Work Unit', name: 'X', parent: 'site', class_uuid: 'c',
    })).rejects.toThrow(/cannot go under a Site/)
    expect(cdb.calls).toEqual([])
  })

  it('adds an alias once', async () => {
    const cdb = recorder()
    expect(await add_alias(cdb, vocab(), 'site', 'P-7')).toBe(true)
    expect(cdb.calls).toEqual([
      ['put', UUIDs.App.ISA95Vocabulary, 'site', { aliases: ['P-7'], children: ['area1', 'area2'] }],
    ])
    expect(await add_alias(cdb, vocab(), 'dup', 'plant7')).toBe(false)
    expect(await add_alias(cdb, vocab(), 'dup', 'p7')).toBe(false)
  })
})
