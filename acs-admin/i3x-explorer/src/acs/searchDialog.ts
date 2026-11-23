/*
 * ACS Admin
 * Whether the Explorer's search dialog is open, and the text it opens with
 * Copyright 2026 University of Sheffield
 *
 * Upstream kept this as state inside the toolbar, which owned the only
 * Search button. The button now sits beside the tree's filter box, and
 * pressing Enter in that box opens the dialog with the filter text, so the
 * tree and the toolbar (which still renders the dialog and handles ⌘K)
 * share it here.
 */

import { create } from 'zustand'

interface SearchDialogState {
  open: boolean
  /** The text the dialog's search box starts with. */
  initialQuery: string
  openSearch(query?: string): void
  closeSearch(): void
}

export const useSearchDialog = create<SearchDialogState>(set => ({
  open: false,
  initialQuery: '',
  openSearch: (query = '') => set({ open: true, initialQuery: query.trim() }),
  closeSearch: () => set({ open: false, initialQuery: '' }),
}))
