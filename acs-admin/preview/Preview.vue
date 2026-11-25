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

      <!-- Edge Scout: the Addresses panel beside the real metric fields,
           laid out as OriginMapEditor lays them out: a stand-in schema
           tree, the metric pane as a size container named `pane`, and the
           panel, which pops out into a large view. `open=0` closes the
           panel and `popout=1` starts it popped out. -->
      <div v-else-if="surface === 'scout'" class="relative flex min-h-0 flex-1 overflow-hidden">
        <div class="m-3 w-64 shrink-0 rounded-lg border bg-gray-100/50 p-3 text-xs text-gray-500">
          <div class="font-semibold text-gray-700">Spindle</div>
          <div class="ml-3 mt-1 rounded bg-gray-200 px-1">Speed</div>
          <div class="ml-3 mt-1 px-1">Load</div>
        </div>
        <div class="@container/pane flex min-w-0 flex-1 flex-col overflow-auto px-6 py-4">
          <header class="mb-3 flex shrink-0 items-start justify-between gap-3 px-1">
            <div class="min-w-0 flex-1">
              <div class="text-sm text-slate-500">
                <span class="hidden @2xl/pane:inline">Spindle &gt; </span><span class="text-slate-950">Speed</span>
              </div>
              <p class="mt-1 text-xs text-gray-400 line-clamp-2" :title="scoutDoc">{{ scoutDoc }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" class="gap-2" title="Manage access" aria-label="Manage access">
                <i class="fa-solid fa-shield-halved text-sm"></i>
                <span class="hidden @3xl/pane:inline">Manage access</span>
              </Button>
              <Button variant="outline" size="sm" class="gap-2" title="Build dataset" aria-label="Build dataset">
                <i class="fa-solid fa-database text-sm"></i>
                <span class="hidden @3xl/pane:inline">Build dataset</span>
              </Button>
              <Button variant="outline" size="sm" class="gap-2" title="Addresses" aria-label="Addresses"
                  :aria-pressed="scoutOpen" @click="scoutOpen = !scoutOpen; scoutPoppedOut = false">
                <i class="fa-solid fa-sitemap text-sm"></i>
                <span class="hidden @3xl/pane:inline">Addresses</span>
              </Button>
            </div>
          </header>
          <SparkplugMetric :selected-metric="scoutMetric" :model="scoutModel" :schema="SPARKPLUG_METRIC"
              connection="preview" can-pick/>
        </div>
        <Teleport to="body" :disabled="!scoutPoppedOut">
          <div v-if="scoutOpen && scoutPoppedOut" class="fixed inset-0 z-50 bg-black/40" @click="scoutPoppedOut = false"></div>
          <aside v-if="scoutOpen"
              :class="scoutPoppedOut ? 'fixed inset-4 z-50 flex shadow-2xl md:inset-8' : 'my-3 mr-3 flex shrink-0'"
              :style="scoutPoppedOut ? null : { width: '640px', maxWidth: 'max(20rem, calc(100% - 41rem))' }">
            <div class="flex min-w-0 flex-1 flex-col rounded-lg border p-3" :class="scoutPoppedOut ? 'bg-white' : 'bg-gray-50'">
              <ScoutPanel ref="scoutPanel" :scout="scout" :driver="scoutDriver" :driver-name="$route.query.driver ?? 'OPC-UA'"
                  :model="scoutModel" :devices="[{ name: 'Mill 1', model: scoutModel }]"
                  :selected-metric="{ path: ['Spindle', 'Speed'], model: scoutModel.Spindle.Speed }"
                  :popped-out="scoutPoppedOut"
                  @pop-out="v => scoutPoppedOut = v" @close="scoutOpen = false"
                  @map="items => { mapItems = items; mapOpen = true }"/>
            </div>
          </aside>
        </Teleport>
        <ScoutMapDialog :open="mapOpen" :items="mapItems" :schema="scoutSchema" :index="scout.current_index.value"
            @close="mapOpen = false" @apply="mapOpen = false"/>
      </div>

      <!-- Driver custom UI contract version 2: the test document in a real
           sandboxed frame, with the scan and the Manager's picker -->
      <div v-else-if="surface === 'driver-ui'" class="flex gap-4 p-4">
        <div class="flex-1 max-w-xl rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-2 text-xs">
            <span class="font-semibold text-gray-700">Driver interface, contract version {{ uiVersion }}</span>
            <button type="button" class="ml-auto rounded border px-2 py-1" data-test="scan-start"
                @click="uiScout.summary = { ...uiScout.summary, state: 'running' }">Pretend a scan started</button>
            <button type="button" class="rounded border px-2 py-1" data-test="scan-done"
                @click="uiScout.summary = { ...uiScout.summary, state: 'done' }">Pretend it finished</button>
          </div>
          <DriverCustomUI :document="uiDocument" :version="uiVersion" :metric="uiMetric"
              :allowed-types="['DoubleBE', 'FloatBE']" :share-samples="$route.query.samples === '1'"
              @propose="v => uiMetric = { ...uiMetric, ...v }"/>
          <div class="mt-3 text-xs text-gray-500">Metric now reads
            <span class="font-mono" data-test="metric-address">{{ uiMetric.Address ?? 'nothing' }}</span>
          </div>
        </div>
        <ScoutPicker :open="picker.open" :index="uiScout.index" :filter="picker.filter"
            @pick="item => closePicker(item)" @close="closePicker(null)"/>
      </div>

      <div v-else class="p-10">
        <p class="text-sm text-gray-500">Unknown surface: {{ surface }}</p>
      </div>
    </main>
  </div>
</template>

<script>
import { markRaw } from 'vue'
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

import ScoutPanel from '@components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutPanel.vue'
import SparkplugMetric from '@components/EdgeManager/Devices/OriginMapEditor/SparkplugMetric.vue'
import { Button } from '@components/ui/button'
import ScoutMapDialog from '@components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutMapDialog.vue'
import ScoutPicker from '@components/EdgeManager/Devices/OriginMapEditor/Scout/ScoutPicker.vue'
import DriverCustomUI from '@components/EdgeManager/Devices/OriginMapEditor/DriverCustomUI.vue'
import scoutV2Document from '../test/fixtures/driver-ui/scout-v2.html?raw'

import { devices, drafts, schemas } from './fixtures.js'
import { target as i3xTarget } from './i3x-fixtures.js'
import { nodes as isa95Nodes } from './isa95-fixtures.js'
import {
  SPARKPLUG_METRIC, preview_scout, preview_index, scout_driver, scout_metric, scout_model,
} from './scout-fixtures.js'

const metric = t => ({ allOf: [{}, { properties: { Sparkplug_Type: { enum: [t] } } }] })
const SCOUT_SCHEMA = {
  properties: {
    Spindle: { properties: { Speed: metric('DoubleBE'), Load: metric('FloatBE') } },
    Feed_Rate: metric('DoubleBE'),
    Coolant_Temp: metric('DoubleBE'),
    Mode: metric('String'),
  },
}

export default {
  name: 'Preview',

  components: {
    ComponentPickerDialog, I3xAccessButton, ISA95, PublishSchema,
    ISA95PlacementPicker, MergeISA95NodeDialog, MoveISA95NodeDialog, NewISA95NodeDialog,
    RawSchemaDialog, SchemaPicker, Schemas, SchemaEditor, Toaster,
    ScoutPanel, ScoutMapDialog, ScoutPicker, DriverCustomUI, SparkplugMetric, Button,
  },

  /* What DriverCustomUI injects for a version 2 document. The functions
   * read live state, as OriginMapEditor's do. */
  provide () {
    return {
      driverUiScout: {
        summary: () => this.uiScout.summary,
        index: () => this.uiScout.index,
        pick: filter => this.openPicker(filter),
      },
    }
  },

  data () {
    /* markRaw keeps the scan's refs as refs. data() makes everything
     * deeply reactive, which unwraps refs inside objects, so the panel
     * would read `.value` of plain values. OriginMapEditor returns the
     * same object from setup(), which leaves it alone. */
    const scout = this.$route.query.surface === 'scout' ? markRaw(preview_scout(this.$route.query.state, this.$route.query)) : null
    return {
      drafts, schemas, devices, i3xTarget, pickerValue: schemas[0]?.uuid ?? null,
      placementA: [], placementB: [], settling: false,
      scout, scoutModel: scout_model, scoutDriver: scout_driver, scoutSchema: SCOUT_SCHEMA,
      scoutMetric: scout_metric, SPARKPLUG_METRIC,
      scoutDoc: scout_metric.model.Documentation,
      scoutOpen: this.$route.query.open !== '0',
      scoutPoppedOut: this.$route.query.popout === '1',
      mapOpen: false, mapItems: [],
      uiDocument: scoutV2Document,
      uiVersion: this.$route.query.v === '1' ? 1 : 2,
      uiMetric: { Address: null },
      uiScout: this.$route.query.surface === 'driver-ui' && this.$route.query.scan !== 'none'
        ? { index: preview_index(), summary: { available: true, state: 'done', finished: '2026-11-24T10:42:13Z', items: preview_index().items.length } }
        : { index: null, summary: { available: false, state: null, finished: null, items: 0 } },
      picker: { open: false, filter: {}, resolve: null },
    }
  },

  /* `demo` sets up an ISA-95 state for screenshots, by driving the
   * page the way a user would:
   *   isa95&demo=duplicate     the tree, open, with a duplicate selected
   *   isa95&demo=add           adding an Area that already exists
   *   isa95-picker&demo=warning  the picker's duplicate warning */
  async mounted () {
    /* `live=ask` opens the Live values dialog, `live=on` turns live
     * values on without it. */
    if (this.scout && this.$route.query.live === 'ask') this.$refs.scoutPanel?.ask_live()
    if (this.scout && this.$route.query.live === 'on') this.scout.live_on()

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
      if (this.surface === 'scout') return 'Edge Scout'
      if (this.surface === 'driver-ui') return 'Driver interface'
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

  methods: {
    /* As OriginMapEditor: one picker at a time. */
    openPicker (filter) {
      if (this.picker.open) return Promise.resolve(null)
      return new Promise(resolve => {
        this.picker = { open: true, filter: filter ?? {}, resolve }
      })
    },

    closePicker (item) {
      const resolve = this.picker.resolve
      this.picker = { open: false, filter: {}, resolve: null }
      resolve?.(item ?? null)
    },
  },
}
</script>
