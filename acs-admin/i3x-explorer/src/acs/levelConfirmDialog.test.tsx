// @vitest-environment jsdom
/*
 * ACS: the dialog asked before subscribing to a large ISA-95 level.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { askLevelConfirm, useLevelConfirm } from './levelConfirm'
import { LevelConfirmDialog } from './LevelConfirmDialog'

afterEach(() => {
  cleanup()
  useLevelConfirm.setState({ request: null })
})

describe('LevelConfirmDialog', () => {
  it('shows nothing until asked', () => {
    render(<LevelConfirmDialog />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers yes from Subscribe to all, and closes', async () => {
    render(<LevelConfirmDialog />)
    let answer!: Promise<boolean>
    act(() => { answer = askLevelConfirm('Subscribe to Enterprise?', 'Enterprise has 40 devices under it.') })
    expect(screen.getByRole('alertdialog').textContent).toContain('40 devices')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to all' }))
    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers no from Cancel or Escape', async () => {
    render(<LevelConfirmDialog />)
    let answer!: Promise<boolean>
    act(() => { answer = askLevelConfirm('Subscribe?', 'Many.') })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answer).resolves.toBe(false)

    act(() => { answer = askLevelConfirm('Subscribe?', 'Many.') })
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await expect(answer).resolves.toBe(false)
  })

  it('answers an earlier question no when a new one is asked', async () => {
    const first = askLevelConfirm('First?', 'One.')
    const second = askLevelConfirm('Second?', 'Two.')
    await expect(first).resolves.toBe(false)
    expect(useLevelConfirm.getState().request?.title).toBe('Second?')
    useLevelConfirm.getState().request?.answer(true)
    await expect(second).resolves.toBe(true)
  })
})
