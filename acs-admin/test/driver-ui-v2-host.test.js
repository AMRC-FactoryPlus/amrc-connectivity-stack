/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Driver custom UI contract version 2, end to end in jsdom.
 *
 * The real shell page (public/driver-ui/host.html) is loaded in a frame,
 * the host controller (lib/driver-ui/host.js, which DriverCustomUI.vue
 * uses) answers it, and the shell writes in a real driver document. The
 * version 2 test document drives scout-query, pick-address and
 * scout-changed. A version 1 document goes through the same path and
 * must get version 1 answers only.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

import { ENVELOPE } from '../src/lib/driver-ui/contract.js'
import { create_host } from '../src/lib/driver-ui/host.js'
import { build_index } from '../src/lib/scout/model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SHELL = fs.readFileSync(path.resolve(here, '../public/driver-ui/host.html'), 'utf8')
const V2_DOC = fs.readFileSync(path.resolve(here, 'fixtures/driver-ui/scout-v2.html'), 'utf8')

/* A version 1 document in the style of Pathfindr's, which records what
 * it receives. */
const V1_DOC = `<!doctype html><html><body><script>
  window.received = [];
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    window.received.push(e.data);
  });
  var m = { type: "ready" }; m.fpDriverUi = 1;
  parent.postMessage(m, "*");
</script></body></html>`

const ITEMS = [
  { id: 'L', parent: null, name: 'Line', kind: 'folder' },
  { id: 'L/speed', parent: 'L', name: 'Speed', kind: 'value', address: 'ns=2;s=Speed', path: null, sample: '1500' },
  { id: 'L/temp', parent: 'L', name: '<b>Temp</b>', kind: 'value', address: 'ns=2;s=Temp', path: null },
  { id: 'L/load', parent: 'L', name: 'Load', kind: 'value', address: 'ns=2;s=Load', path: null },
]

let dom = null
afterEach(() => { dom?.window.close(); dom = null })

const until = async (check, what) => {
  for (let i = 0; i < 200; i++) {
    const v = check()
    if (v) return v
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/* Load the shell in a frame of an outer page, and connect the host
 * controller as DriverCustomUI does. */
function mount ({ document, version, summary, index, pick }) {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://console.example.test/devices/1',
  })
  const outer = dom.window
  const frame = outer.document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  outer.document.body.appendChild(frame)
  const inner = frame.contentWindow

  /* jsdom's postMessage delivers with `source` null, and both the shell
   * and the documents check `source` as a browser sets it. So messages go
   * through this shim, which delivers a structured clone asynchronously
   * with the right source, as a browser does. */
  const deliver = (target, data, source) => setTimeout(() =>
    target.dispatchEvent(new target.MessageEvent('message', { data: structuredClone(data), source })), 0)
  outer.postMessage = data => deliver(outer, data, inner)
  inner.postMessage = data => deliver(inner, data, outer)

  const log = { posted: [], proposed: [], problems: [] }
  const state = { summary }
  const host = create_host({
    post: m => {
      log.posted.push(m)
      frame.contentWindow.postMessage(m, '*')
    },
    document,
    version,
    share_samples: false,
    init_values: () => ({ config: {}, metric: { Address: '' }, allowed_types: ['Double'] }),
    scout: {
      summary: () => state.summary,
      index: () => index,
      pick,
    },
    on: {
      propose: v => log.proposed.push(v),
      problems: p => log.problems.push(...p),
    },
  })

  outer.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return
    host.handle(e.data)
  })

  /* Write the shell into the frame, as loading its URL would. */
  const doc = frame.contentDocument
  doc.open()
  doc.write(SHELL)
  doc.close()

  return { outer, frame, host, log, state }
}

describe('a version 2 driver document in the real shell', () => {
  const index = build_index(ITEMS)
  const summary = { available: true, state: 'done', finished: '2026-11-24T10:42:13Z', items: 4 }

  it('receives init.scout and lists items with scout-query', async () => {
    const { frame, log } = mount({ document: V2_DOC, version: 2, summary, index, pick: async () => null })
    const text = () => frame.contentDocument.getElementById('summary')?.textContent
    await until(() => text() === '4 addresses, state done', 'the summary')

    const init = log.posted.find(m => m.type === 'init')
    expect(init[ENVELOPE]).toBe(2)
    expect(init.scout).toEqual(summary)

    const list = () => [...frame.contentDocument.querySelectorAll('#items li')].map(li => li.textContent)
    await until(() => list().length === 2, 'the item list')
    expect(list()).toEqual(['Speed ns=2;s=Speed', '<b>Temp</b> ns=2;s=Temp'])
    /* The hostile name stayed text. */
    expect(frame.contentDocument.querySelector('#items b')).toBeNull()

    const answer = log.posted.find(m => m.type === 'scout-items')
    expect(answer[ENVELOPE]).toBe(2)
    expect(answer.items.every(i => !('sample' in i))).toBe(true)
  })

  it('picks through the Manager and proposes the address', async () => {
    let asked = null
    const { frame, log } = mount({
      document: V2_DOC, version: 2, summary, index,
      pick: async filter => { asked = filter; return ITEMS[3] },
    })
    const btn = await until(() => frame.contentDocument.getElementById('pick'), 'the document')
    await until(() => log.posted.some(m => m.type === 'init'), 'init')
    btn.click()
    await until(() => log.proposed.length, 'the proposal')
    expect(asked).toEqual({ kind: 'value' })
    expect(log.proposed[0]).toEqual({ Address: 'ns=2;s=Load', Path: null })
    expect(frame.contentDocument.getElementById('picked').textContent).toBe('ns=2;s=Load')
  })

  it('hears that the operator closed the picker', async () => {
    const { frame, log } = mount({ document: V2_DOC, version: 2, summary, index, pick: async () => null })
    const btn = await until(() => frame.contentDocument.getElementById('pick'), 'the document')
    await until(() => log.posted.some(m => m.type === 'init'), 'init')
    btn.click()
    await until(() => frame.contentDocument.getElementById('picked').textContent, 'the answer')
    expect(frame.contentDocument.getElementById('picked').textContent).toBe('Nothing chosen')
    expect(log.proposed).toEqual([])
  })

  it('hears scout-changed when a scan starts', async () => {
    const { frame, host, log } = mount({ document: V2_DOC, version: 2, summary, index, pick: async () => null })
    await until(() => log.posted.some(m => m.type === 'init'), 'init')
    host.scout_changed({ available: true, state: 'running', finished: null, items: 4 })
    const text = () => frame.contentDocument.getElementById('summary').textContent
    await until(() => text() === '4 addresses, state running', 'the change')
  })

  it('works with no snapshot', async () => {
    const empty = { available: false, state: null, finished: null, items: 0 }
    const { frame, log } = mount({ document: V2_DOC, version: 2, summary: empty, index: null, pick: async () => ITEMS[1] })
    const btn = await until(() => frame.contentDocument.getElementById('pick'), 'the document')
    await until(() => frame.contentDocument.getElementById('summary').textContent === 'No scan', 'the summary')
    btn.click()
    await until(() => frame.contentDocument.getElementById('picked').textContent, 'the answer')
    expect(frame.contentDocument.getElementById('picked').textContent).toBe('Nothing chosen')
    expect(log.posted.some(m => m.type === 'scout-items')).toBe(false)
  })
})

describe('a version 1 driver document in the same shell', () => {
  it('gets version 1 answers and no scout data', async () => {
    const index = build_index(ITEMS)
    const summary = { available: true, state: 'done', finished: 't', items: 4 }
    const { frame, log } = mount({ document: V1_DOC, version: 1, summary, index, pick: async () => ITEMS[1] })
    await until(() => frame.contentWindow.received?.length, 'init')
    const init = frame.contentWindow.received[0]
    expect(init[ENVELOPE]).toBe(1)
    expect(init.type).toBe('init')
    expect(init).not.toHaveProperty('scout')
    expect(log.posted.every(m => m[ENVELOPE] === 1)).toBe(true)

    /* A version 1 document cannot use the version 2 messages. */
    frame.contentWindow.eval('var m = { type: "pick-address" }; m.fpDriverUi = 1; parent.postMessage(m, "*")')
    await new Promise(r => setTimeout(r, 30))
    expect(log.posted.some(p => p.type === 'picked')).toBe(false)
  })
})
