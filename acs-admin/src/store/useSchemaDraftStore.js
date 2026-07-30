/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { useStore } from '@store/useStore.ts'

import { SCHEMA_DRAFT_APP, SCHEMA_DRAFT_CLASS } from '@/lib/schema/registry.js'

/**
 * Schema drafts.
 *
 * Kept in their own class rather than Class.Schema so an unfinished
 * schema stays invisible to the schema store, the origin map editor,
 * acs-i3x and the edge agent, all of which enumerate by class
 * membership.
 */
export const useSchemaDraftStore = () => useStore(
  'schemaDraft',
  SCHEMA_DRAFT_CLASS,
  {
    draft: SCHEMA_DRAFT_APP,
  },
)()
