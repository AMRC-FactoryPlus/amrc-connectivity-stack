/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useSchemaStore = () => useStore(
  'schema',
  UUIDs.Class.Schema,
  {
    // Bind both SchemaInformation and Schema apps eagerly
    schemaInformation: UUIDs.App.SchemaInformation,
    schema: UUIDs.App.Schema
  }
)()