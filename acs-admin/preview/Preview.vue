<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Design preview harness. Renders one schema editor surface at a time
  - against fixture data, with no authentication and no ConfigDB, so the
  - states can be seen and screenshotted without a deployment.
  -
  - Not part of the shipped application.
  -->

<template>
  <div class="flex h-screen flex-col bg-white">
    <Toaster visible-toasts="3" rich-colors/>

    <header class="flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 px-4">
      <i class="fa-solid fa-sitemap"></i>
      <h3 class="text-lg font-bold tracking-tight">Schemas</h3>
      <span class="ml-auto text-xs text-gray-400">Preview: {{ surface }}</span>
    </header>

    <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Schemas v-if="surface === 'list'"/>
      <SchemaEditor v-else-if="surface === 'editor'" :key="$route.fullPath"/>
      <PublishSchema v-else-if="surface === 'publish'" :key="$route.fullPath"/>

      <ComponentPickerDialog v-else-if="surface === 'component-picker'"
          :open="true" :candidates="candidates" :is-replacing="false"/>

      <RawSchemaDialog v-else-if="surface === 'raw'"
          :open="true" :body="drafts[0].draft.body"/>

      <div v-else class="p-10">
        <p class="text-sm text-gray-500">Unknown surface: {{ surface }}</p>
      </div>
    </main>
  </div>
</template>

<script>
import { Toaster } from '@components/ui/sonner'

import Schemas from '@pages/Schemas/Schemas.vue'
import SchemaEditor from '@pages/Schemas/SchemaEditor.vue'
import PublishSchema from '@pages/Schemas/PublishSchema.vue'
import ComponentPickerDialog from '@components/Schemas/ComponentPickerDialog.vue'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'

import { drafts, schemas } from './fixtures.js'

export default {
  name: 'Preview',

  components: {
    ComponentPickerDialog, PublishSchema, RawSchemaDialog, Schemas,
    SchemaEditor, Toaster,
  },

  data () {
    return { drafts }
  },

  computed: {
    surface () {
      return this.$route.query.surface ?? 'list'
    },

    candidates () {
      return schemas
        .map(s => ({
          uuid: s.uuid,
          label: `${s.schemaInformation.name} v${s.schemaInformation.version}`,
          origin: s.schemaInformation.source === 'acs-admin' ? 'Local' : 'AMRC library',
          isDraft: false,
        }))
        .concat(drafts.map(d => ({
          uuid: d.draft.schemaUuid,
          label: d.draft.name,
          origin: 'Draft',
          isDraft: true,
        })))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
  },
}
</script>
