// @vitest-environment jsdom
/*
 * ACS: tests for the relationship list's rows: full names, a UUID type id cut
 * to its last 5 characters, and no count or help line.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ObjectInstance } from '../../api/types'
import type { EgoGraph } from './egoGraph'
import { buildEgoTree } from './egoTree'
import { RelationshipList, shortTypeId } from './RelationshipList'

afterEach(cleanup)

const SCHEMA = '2dd093e9-1450-44c5-be8c-c0d78e48219b'

const obj = (elementId: string, displayName: string, typeId: string): ObjectInstance => ({
  elementId,
  displayName,
  typeId,
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:ns',
})

function tree() {
  const graph: EgoGraph = {
    nodes: [
      { object: obj('root', 'Line 1', 'isa95-level'), depth: 0 },
      { object: obj('press', 'Press 3 hydraulic forming station', SCHEMA), depth: 1, via: 'root', viaBucket: 'child' },
      { object: obj('cell', 'Cell A', 'isa95-level'), depth: 1, via: 'root', viaBucket: 'child' },
    ],
    edges: [
      { source: 'root', target: 'press', relationshipType: 'HasChildren', bucket: 'child' },
      { source: 'root', target: 'cell', relationshipType: 'HasChildren', bucket: 'child' },
    ],
  }
  return buildEgoTree(graph)
}

describe('shortTypeId', () => {
  it('cuts a UUID to its last 5 characters and leaves a readable id alone', () => {
    expect(shortTypeId(SCHEMA)).toBe('8219b')
    expect(shortTypeId('isa95-level')).toBe('isa95-level')
    expect(shortTypeId(undefined)).toBe('')
  })
})

describe('RelationshipList rows', () => {
  const renderList = () => render(
    <RelationshipList
      tree={tree()}
      isLoading={false}
      error={null}
      onSelect={vi.fn()}
      onFocus={vi.fn()}
      onRoot={vi.fn()}
    />
  )

  it('shows the name in full beside the last 5 characters of a UUID type id', () => {
    renderList()
    const name = screen.getByText('Press 3 hydraulic forming station')
    expect(name.className).not.toContain('truncate')
    const type = screen.getByText('8219b')
    expect(type.getAttribute('title')).toBe(SCHEMA)
    expect(type.className).toContain('font-mono')
    expect(type.className).toContain('ml-auto')
    expect(screen.queryByText(SCHEMA)).toBeNull()
    expect(screen.getByText('isa95-level')).toBeTruthy()
  })

  it('has no direct-count or right-click line', () => {
    const { container } = renderList()
    expect(container.textContent).not.toMatch(/direct/)
    expect(container.textContent).not.toMatch(/right-click/)
  })
})
