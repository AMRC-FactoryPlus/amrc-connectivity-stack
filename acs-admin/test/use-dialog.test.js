// @vitest-environment jsdom
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'

import { close_dialogs, useDialog } from '@/composables/useDialog.js'

const dialogs = () => document.querySelectorAll('[role="alertdialog"]')

afterEach(() => {
  close_dialogs()
  document.body.innerHTML = ''
})

describe('useDialog', () => {
  it('closes every open dialog, without confirming or cancelling', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    useDialog({ title: 'Delete this node?', onConfirm, onCancel })
    useDialog({ title: 'Leave without saving?', onConfirm, onCancel })
    await nextTick()
    expect(dialogs()).toHaveLength(2)

    close_dialogs()
    await nextTick()

    expect(dialogs()).toHaveLength(0)
    expect(document.body.children).toHaveLength(0)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('forgets a dialog once it is answered', async () => {
    const onConfirm = vi.fn()
    useDialog({ title: 'Delete this node?', confirmText: 'Delete node', onConfirm })
    await nextTick()
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Delete node'))
    button.click()
    await nextTick()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(dialogs()).toHaveLength(0)
    expect(() => close_dialogs()).not.toThrow()
  })

  it('shows a destructive confirm button in red', async () => {
    useDialog({ title: 'Delete this node?', confirmText: 'Delete node', destructive: true })
    await nextTick()
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Delete node'))
    expect(button.className).toContain('bg-red-500')
    expect(button.className).toContain('text-white')
    expect(button.className).not.toContain('bg-slate-900')
  })

  it('keeps an ordinary confirm button dark', async () => {
    useDialog({ title: 'Turn on live values?', confirmText: 'Turn on' })
    await nextTick()
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Turn on'))
    expect(button.className).toContain('bg-slate-900')
    expect(button.className).not.toContain('bg-red-500')
  })
})
