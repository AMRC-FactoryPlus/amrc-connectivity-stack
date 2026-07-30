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
  <div class="h-screen flex flex-col bg-white">
    <Toaster visible-toasts="3" rich-colors/>

    <header class="flex items-center gap-2 border-b px-4 h-16 shrink-0">
      <i :class="`fa-solid fa-${icon}`"></i>
      <h3 class="text-lg font-bold tracking-tight">{{ heading }}</h3>
      <span class="ml-auto text-xs text-gray-400">Preview: {{ surface }}</span>
    </header>

    <main class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <Schemas v-if="surface === 'list'"/>
      <SchemaEditor v-else-if="surface === 'editor'" :key="$route.fullPath"/>

      <PublishDialog v-else-if="surface === 'publish-breaking'"
          :open="true" name="CNC Sheffield" :version="1"
          :based-on="uuids.LOCAL_V1"
          :changes="breakingChanges" :breaking="true"
          :configured="devices.slice(0, 3)"
          :publishing="['a', 'b']"
          :referenced-by="[{ uuid: 'x' }]"
          :unresolved="[]" :schema-names="schemaNames"/>

      <PublishDialog v-else-if="surface === 'publish-additive'"
          :open="true" name="CNC Sheffield" :version="1"
          :based-on="uuids.LOCAL_V1"
          :changes="additiveChanges" :breaking="false"
          :configured="devices.slice(0, 3)"
          :publishing="[]"
          :referenced-by="[]"
          :unresolved="[]" :schema-names="schemaNames"/>

      <PublishDialog v-else-if="surface === 'publish-blocked'"
          :open="true" name="Laser Cutter" :version="1"
          :based-on="null"
          :changes="[]" :breaking="false"
          :configured="[]"
          :publishing="null"
          :referenced-by="[]"
          :unresolved="[uuids.SPINDLE]" :schema-names="draftNames"/>

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
import PublishDialog from '@components/Schemas/PublishDialog.vue'
import ComponentPickerDialog from '@components/Schemas/ComponentPickerDialog.vue'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'

import { devices, drafts, schemas, uuids } from './fixtures.js'
import { classify } from '@/lib/schema/classify.js'
import { parse, serialise, newMetric } from '@/lib/schema/document.js'

const local = schemas.find(s => s.uuid === uuids.LOCAL_V1)

/* Classified from real edits rather than hand-written, so the preview
 * shows what the classifier actually produces. */
const withRename = () => {
  const doc = parse(local.schema)
  const spindles = doc.children.find(n => n.key === 'Spindles')
  spindles.key = 'Spindle_Units'
  doc.children.push(newMetric('Coolant_Temp'))
  return serialise(doc)
}

const withAddition = () => {
  const doc = parse(local.schema)
  const added = newMetric('Coolant_Temp')
  added.fields.Sparkplug_Type = ['DoubleLE']
  added.fields.Eng_Unit = '°C'
  doc.children.push(added)
  doc.children.push(newMetric('Spindle_Hours'))
  return serialise(doc)
}

export default {
  name: 'Preview',

  components: {
    ComponentPickerDialog, PublishDialog, RawSchemaDialog, Schemas,
    SchemaEditor, Toaster,
  },

  data () {
    return { devices, drafts, uuids }
  },

  computed: {
    surface () {
      return this.$route.query.surface ?? 'list'
    },

    heading () {
      return this.surface === 'editor' ? 'Schemas' : 'Schemas'
    },

    icon () {
      return 'diagram-project'
    },

    schemaNames () {
      return Object.fromEntries(schemas.map(s =>
        [s.uuid, `${s.schemaInformation.name} (v${s.schemaInformation.version})`]))
    },

    draftNames () {
      return { ...this.schemaNames, [uuids.SPINDLE]: 'Spindle (draft)' }
    },

    breakingChanges () {
      return classify(local.schema, withRename()).changes
    },

    additiveChanges () {
      return classify(local.schema, withAddition()).changes
    },

    candidates () {
      return schemas
        .map(s => ({
          uuid: s.uuid,
          label: `${s.schemaInformation.name} (v${s.schemaInformation.version})`,
          isDraft: false,
        }))
        .concat(drafts.map(d => ({
          uuid: d.draft.schemaUuid,
          label: d.draft.name,
          isDraft: true,
        })))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
  },
}
</script>
