/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * EdgeContainer scrolling.
 *
 * EdgeContainer wraps the edge cluster, node and device pages. Its root
 * has a fixed height (the viewport less the header), so the area that
 * holds the page content is the only thing that can scroll. When that
 * area had overflow-hidden, a node with ~2,000 devices rendered a table
 * over 128,000px tall inside a 775px box and the rest of the rows could
 * not be reached.
 *
 * The unit tests run without a browser, so there is no layout to
 * measure. These tests check the structure that causes the bug instead:
 * a fixed-height root whose content area clips vertical overflow.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'vue/compiler-sfc'

const FILE = new URL('../src/components/Containers/EdgeContainer.vue', import.meta.url)

function template_root () {
  const { descriptor, errors } = parse(readFileSync(FILE, 'utf-8'))
  expect(errors).toEqual([])
  return descriptor.template.ast.children.find(n => n.type === 1)
}

function static_classes (node) {
  const attr = node.props.find(p => p.type === 6 && p.name === 'class')
  return attr ? attr.value.content.split(/\s+/).filter(Boolean) : []
}

function elements (node) {
  return (node.children ?? []).filter(n => n.type === 1)
}

/* The element that wraps the default slot, which is where the page
 * content goes. */
function content_area (root) {
  return elements(root).find(el =>
    elements(el).some(c => c.tag === 'slot'
      && !c.props.some(p => p.type === 6 && p.name === 'name')))
}

describe('EdgeContainer', () => {
  it('has a fixed-height root', () => {
    /* If this changes, the reasoning behind the tests below may no
     * longer hold, so check the scrolling again in a browser. */
    const classes = static_classes(template_root())
    expect(classes.some(c => /^h-\[calc\(100vh/.test(c))).toBe(true)
  })

  it('lets the page content scroll vertically', () => {
    const area = content_area(template_root())
    expect(area).toBeDefined()
    const classes = static_classes(area)

    expect(classes).toContain('overflow-y-auto')
    expect(classes).not.toContain('overflow-hidden')
    expect(classes).not.toContain('overflow-y-hidden')
  })

  it('keeps the page content in the flex column', () => {
    /* flex-1 gives the content area the height left under the
     * breadcrumbs. Without it the area grows to fit its content and
     * never scrolls. */
    expect(static_classes(content_area(template_root()))).toContain('flex-1')
  })
})
