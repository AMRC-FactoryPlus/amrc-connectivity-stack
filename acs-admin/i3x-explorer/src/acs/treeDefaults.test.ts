// ACS: Hierarchy is the folder the Explorer opens on.
import { describe, it, expect } from 'vitest'
import { useExplorerStore, HIERARCHY_OPEN_BY_DEFAULT } from '../stores/explorer'
import { HIERARCHICAL_FOLDER_ID } from '../components/tree/treeData'

describe('the tree on start', () => {
  it('has Hierarchy open', () => {
    expect(HIERARCHY_OPEN_BY_DEFAULT).toBe(HIERARCHICAL_FOLDER_ID)
    expect(useExplorerStore.getInitialState().expandedNodes.has(HIERARCHICAL_FOLDER_ID)).toBe(true)
  })
})
