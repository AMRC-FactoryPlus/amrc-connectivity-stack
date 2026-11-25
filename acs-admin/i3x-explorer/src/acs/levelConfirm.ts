/*
 * ACS: the question asked before subscribing to a large ISA-95 level. See FORK.md.
 *
 * This used to be window.confirm. A browser can stop a page showing native
 * dialogs (Chrome's "prevent this page from creating additional dialogs", and
 * some embedded browsers dismiss them on their own), and window.confirm then
 * returns false at once. Subscribing to a big level, usually the enterprise,
 * then did nothing at all. The question is asked in the Explorer's own dialog
 * instead, which LevelConfirmDialog draws.
 */

import { create } from 'zustand'

export interface LevelConfirmRequest {
  title: string
  message: string
  answer: (yes: boolean) => void
}

export const useLevelConfirm = create<{ request: LevelConfirmRequest | null }>(() => ({ request: null }))

/**
 * Asks the question and resolves with the answer. A second question while one
 * is open answers the first with no.
 */
export function askLevelConfirm(title: string, message: string): Promise<boolean> {
  useLevelConfirm.getState().request?.answer(false)
  return new Promise(resolve => {
    const request: LevelConfirmRequest = {
      title,
      message,
      answer: yes => {
        if (useLevelConfirm.getState().request === request) useLevelConfirm.setState({ request: null })
        resolve(yes)
      },
    }
    useLevelConfirm.setState({ request })
  })
}
