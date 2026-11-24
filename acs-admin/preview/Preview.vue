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
      <i class="fa-solid" :class="surface === 'i3x-isa95' ? 'fa-sitemap' : 'fa-shapes'"></i>
      <h3 class="text-lg font-bold tracking-tight">{{ title }}</h3>
      <span class="ml-auto text-xs text-gray-400">Preview: {{ surface }}</span>
    </header>

    <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Schemas v-if="surface === 'list'"/>
      <SchemaEditor v-else-if="surface === 'editor'" :key="$route.fullPath"/>
      <PublishSchema v-else-if="surface === 'publish'" :key="$route.fullPath"/>

      <ComponentPickerDialog v-else-if="surface === 'component-picker'"
          :open="true" :candidates="candidates" :is-replacing="false"/>

      <div v-else-if="surface === 'schema-picker'" class="p-8">
        <div class="mx-auto max-w-[600px] rounded-lg border border-slate-200 p-5 shadow-sm">
          <div class="mb-1 text-lg font-semibold tracking-tight">Select a schema</div>
          <p class="mb-4 text-sm text-slate-500">Choose the data model for this device</p>
          <SchemaPicker v-model="pickerValue" :schemas="schemas" :devices="devices"
              latest-only/>
        </div>
      </div>

      <RawSchemaDialog v-else-if="surface === 'raw'"
          :open="true" :body="drafts[0].draft.body"/>

      <div v-else-if="surface === 'i3x-device'" class="p-6">
        <div class="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
          <div class="flex flex-col">
            <span class="font-semibold">{{ i3xTarget.name }}</span>
            <span class="text-xs text-slate-500">{{ i3xPath }}</span>
          </div>
          <I3xAccessButton device :target="i3xTarget.uuid" :via="i3xTarget.via"
              :name="i3xTarget.name" :path="i3xPath"/>
        </div>
      </div>

      <ISA95 v-else-if="surface === 'i3x-isa95'"/>

      <div v-else-if="surface === 'isa95'" class="flex min-h-0 flex-1 flex-col p-4">
        <ISA95/>
        <MergeISA95NodeDialog/>
        <MoveISA95NodeDialog/>
        <NewISA95NodeDialog/>
      </div>

      <div v-else-if="surface === 'isa95-picker'" class="flex gap-8 overflow-auto p-6">
        <div class="shrink-0 space-y-2" style="width: 352px">
          <div class="text-sm font-semibold">Device sidebar (352px)</div>
          <ISA95PlacementPicker v-model="placementA" compact/>
          <div class="text-xs text-slate-500 break-all">{{ placementA }}</div>
        </div>
        <div class="shrink-0 space-y-2" style="width: 552px">
          <div class="text-sm font-semibold">New device dialog (552px)</div>
          <ISA95PlacementPicker v-model="placementB" required @settling="v => settling = v"/>
          <div class="text-xs text-slate-500">Create is {{ settling ? 'held: settle the placement first' : 'allowed' }}</div>
        </div>
      </div>

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
import SchemaPicker from '@components/Schemas/SchemaPicker.vue'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'

import I3xAccessButton from '@components/Access/I3xAccessButton.vue'
import ISA95 from '@pages/ISA95/ISA95.vue'
import ISA95PlacementPicker from '@components/ISA95/ISA95PlacementPicker.vue'
import MergeISA95NodeDialog from '@components/ISA95/MergeISA95NodeDialog.vue'
import MoveISA95NodeDialog from '@components/ISA95/MoveISA95NodeDialog.vue'
import NewISA95NodeDialog from '@components/ISA95/NewISA95NodeDialog.vue'

import { devices, drafts, schemas } from './fixtures.js'
import { target as i3xTarget } from './i3x-fixtures.js'
import { nodes as isa95Nodes } from './isa95-fixtures.js'

export default {
  name: 'Preview',

  components: {
    ComponentPickerDialog, I3xAccessButton, ISA95, PublishSchema,
    ISA95PlacementPicker, MergeISA95NodeDialog, MoveISA95NodeDialog, NewISA95NodeDialog,
    RawSchemaDialog, SchemaPicker, Schemas, SchemaEditor, Toaster,
  },

  data () {
    return {
      drafts, schemas, devices, i3xTarget, pickerValue: schemas[0]?.uuid ?? null,
      placementA: [], placementB: [], settling: false,
    }
  },

  /* `demo` sets up an ISA-95 state for screenshots, by driving the
   * page the way a user would:
   *   isa95&demo=duplicate     the tree, open, with a duplicate selected
   *   isa95&demo=add           adding an Area that already exists
   *   isa95-picker&demo=warning  the picker's duplicate warning */
  async mounted () {
    const demo = this.$route.query.demo
    if (!demo) return
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const row = name => [...document.querySelectorAll('[role=treeitem]')]
      .find(e => e.getAttribute('aria-label').startsWith(name + ','))
    const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    const type = async (input, text) => {
      input.focus()
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(300)
    }
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    await wait(500)

    if (this.surface === 'isa95') {
      button('Expand all')?.click()
      await wait(200)
      if (demo === 'duplicate') row('NW')?.click()
      if (demo === 'add') {
        const r = row('South Works')
        r?.click()
        await wait(100)
        r?.querySelector('button[title^="Add"]')?.click()
        await wait(200)
        const input = document.activeElement
        await type(input, 'Machining')
        key(input, 'Enter')
      }
    }

    if (this.surface === 'isa95-picker' && demo === 'warning') {
      this.placementB = [isa95Nodes[0].uuid]
      await wait(300)
      const site = document.querySelectorAll('input[role=combobox]')[6]
      await type(site, 'North-Works')
      key(site, 'ArrowDown')
      await wait(100)
      key(site, 'Enter')
    }
  },

  computed: {
    surface () {
      return this.$route.query.surface ?? 'list'
    },

    title () {
      if (this.surface === 'i3x-isa95' || this.surface === 'isa95') return 'ISA-95 Hierarchy'
      if (this.surface === 'isa95-picker') return 'ISA-95 Placement'
      if (this.surface === 'i3x-device') return 'Devices'
      return 'Schemas'
    },

    i3xPath () {
      return this.i3xTarget.via.map(n => n.name).join(' / ')
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
