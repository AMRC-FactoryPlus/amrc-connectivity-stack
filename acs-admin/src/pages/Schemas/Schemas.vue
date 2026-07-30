<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The schema list.
  -
  - Most of a deployment's schemas are the AMRC library and are noise to
  - the person looking for their own. So yours come first, the library
  - sits below a divider, and the tabs let you drop the library entirely.
  -->

<template>
  <div class="flex h-[calc(100vh-4rem)] flex-col -m-4">
    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col p-4">
        <Skeleton v-if="!ready" v-for="i in 10" class="mb-2 h-16 rounded-lg"/>

        <DataTableSearchable v-else
            :columns="columns"
            :data="rows"
            :filters="filters"
            :limit-height="false"
            :clickable="true"
            :selected-objects="[]"
            :default-sort="initialSort"
            :search-key="null"
            @row-click="e => selectedUuid = e.original.uuid">
          <template #toolbar-left>
            <Tabs v-model="tab">
              <TabsList>
                <TabsTrigger v-for="t in tabs" :key="t.value" :value="t.value">
                  {{ t.label }}
                  <span class="ml-1.5 opacity-55">{{ t.count }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </template>
          <template #toolbar-right>
            <Button variant="ghost" size="sm" class="text-slate-500 whitespace-nowrap"
                @click="hideSuperseded = !hideSuperseded">
              <i class="fa-solid mr-2" :class="hideSuperseded ? 'fa-eye' : 'fa-eye-slash'"></i>
              {{ hideSuperseded ? 'Show superseded' : 'Hide superseded' }}
            </Button>
            <Button size="sm" class="whitespace-nowrap" @click="newSchema">
              <i class="fa-solid fa-plus mr-2"></i>New schema
            </Button>
          </template>
          <template #empty>
            <EmptyState
                title="No schemas here"
                :description="emptyDescription"
                button-text="New schema"
                button-icon="plus"
                @button-click="newSchema"/>
          </template>
        </DataTableSearchable>
      </div>

      <!-- Detail rail -->
      <div v-if="selected" class="w-96 shrink-0 overflow-y-auto border-l border-slate-200">
        <div class="flex items-center justify-between gap-1 border-b border-slate-200 p-4">
          <div class="flex min-w-0 items-center gap-2 text-xl font-semibold">
            <i class="fa-solid fa-sitemap shrink-0 text-sm text-slate-500"></i>
            <span class="truncate">{{ selected.name }}</span>
          </div>
          <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0"
              @click="selectedUuid = null">
            <i class="fa-solid fa-times text-slate-500"></i>
          </Button>
        </div>

        <div class="flex flex-col gap-4 p-4">
          <div class="flex items-center gap-1.5">
            <Badge v-if="selected.isDraft" variant="outline"
                class="gap-1.5 border-dashed font-normal">
              <i class="fa-solid fa-pen text-[8px]"></i>Draft
            </Badge>
            <span class="text-xs text-gray-500">{{ statusLine }}</span>
          </div>

          <SidebarDetail icon="box" label="Origin" :value="selected.origin"/>
          <SidebarDetail icon="key" label="Schema UUID" :value="selected.schemaUuid"/>

          <div class="h-px bg-slate-200"></div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lineage
          </div>
          <LineageTimeline :events="lineage" @open="openUuid"/>

          <template v-if="!selected.isDraft">
            <div class="h-px bg-slate-200"></div>
            <SidebarDetail icon="microchip" label="Devices using this"
                :value="usageSummary"/>
            <SidebarDetail icon="cubes" label="Used in schemas"
                :value="referenceSummary"/>
          </template>

          <div class="h-px bg-slate-200"></div>
          <div class="flex flex-col gap-2">
            <Button v-if="selected.isDraft" class="w-full" @click="open">
              <i class="fa-solid fa-pen-to-square mr-2"></i>Edit schema
            </Button>
            <Button v-else-if="selected.origin === 'AMRC library'" class="w-full"
                @click="fork">
              <i class="fa-solid fa-code-branch mr-2"></i>Make a local copy
            </Button>
            <Button v-else class="w-full" @click="open">
              <i class="fa-solid fa-pen-to-square mr-2"></i>Edit schema
            </Button>

            <Button v-if="selected.isDraft" variant="outline" class="w-full"
                @click="publishDraft">
              <i class="fa-solid fa-rocket mr-2"></i>Publish
            </Button>
            <Button v-else-if="selected.origin !== 'AMRC library'" variant="ghost"
                class="w-full justify-start text-slate-500" @click="fork">
              <i class="fa-solid fa-code-branch mr-2"></i>Fork
            </Button>

            <Button v-if="selected.isDraft" variant="destructiveGhost"
                class="w-full justify-start" @click="removeDraft">
              <i class="fa-solid fa-trash mr-2"></i>Delete draft
            </Button>
          </div>

          <p v-if="selected.origin === 'AMRC library'" class="text-xs text-gray-500">
            This schema comes from the AMRC library. Editing creates a local copy.
          </p>
        </div>
      </div>
    </div>

    <ForkDialog/>
  </div>
</template>

<script>
import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { Tabs, TabsList, TabsTrigger } from '@components/ui/tabs'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import SidebarDetail from '@components/SidebarDetail.vue'
import EmptyState from '@components/EmptyState.vue'
import ForkDialog from '@components/Schemas/ForkDialog.vue'
import LineageTimeline from '@components/Schemas/LineageTimeline.vue'
import { schemaColumns } from './schemaColumns.ts'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog.js'


import {
  deleteDraft, derivedFromOf, isLibrarySchema, successorIndex, versionOf,
} from '@/lib/schema/registry.js'
import { buildUsageIndex } from '@/lib/schema/usage.js'

export default {
  name: 'Schemas',

  components: {
    Badge, Button, DataTableSearchable, EmptyState, ForkDialog, LineageTimeline,
    SidebarDetail, Skeleton, Tabs, TabsList, TabsTrigger,
  },

  setup () {
    return {
      selectedUuid: ref(null),
      columns: schemaColumns,
      sch: useSchemaStore(),
      drafts: useSchemaDraftStore(),
      dev: useDeviceStore(),
      s: useServiceClientStore(),
    }
  },

  data () {
    return {
      tab: 'yours',
      hideSuperseded: false,
    }
  },

  async mounted () {
    await Promise.all([this.sch.start(), this.drafts.start(), this.dev.start()])
  },

  computed: {
    ready () {
      return this.sch.ready && this.drafts.ready
    },

    successors () {
      return successorIndex(this.sch.data)
    },

    /* One pass over every schema and device, rather than one pass per
     * row. Per-row was quadratic and cost about a second of blocked main
     * thread on a real library. */
    usage () {
      return buildUsageIndex(this.sch.data, this.dev.data)
    },

    allRows () {
      const published = (this.sch.data ?? []).map(entry => ({
        uuid: entry.uuid,
        schemaUuid: entry.uuid,
        name: entry.schemaInformation?.name ?? entry.name ?? entry.uuid,
        version: versionOf(entry),
        origin: isLibrarySchema(entry) ? 'AMRC library' : 'Local',
        isLibrary: isLibrarySchema(entry),
        isDraft: false,
        usedBy: this.usage.devices.get(entry.uuid) ?? 0,
        referencedBy: this.usage.referencedBy.get(entry.uuid) ?? 0,
        supersededBy: this.successors.get(entry.uuid)?.uuid ?? null,
        derivedFrom: derivedFromOf(entry),
      }))

      const drafts = (this.drafts.data ?? [])
        .filter(entry => entry.draft)
        .map(entry => ({
          uuid: entry.uuid,
          schemaUuid: entry.draft.schemaUuid,
          name: entry.draft.name,
          version: entry.draft.version ?? 1,
          origin: 'Local',
          isLibrary: false,
          isDraft: true,
          usedBy: 0,
          referencedBy: 0,
          supersededBy: null,
          derivedFrom: entry.draft.derivedFrom ?? null,
          basedOn: entry.draft.basedOn ?? null,
        }))

      return [...drafts, ...published]
    },

    tabs () {
      const yours = this.allRows.filter(r => !r.isLibrary).length
      return [
        { value: 'yours', label: 'Yours', count: yours },
        { value: 'drafts', label: 'Drafts', count: this.allRows.filter(r => r.isDraft).length },
        { value: 'library', label: 'Library', count: this.allRows.filter(r => r.isLibrary).length },
        { value: 'all', label: 'All', count: this.allRows.length },
      ]
    },

    /* The tabs and the superseded toggle narrow the set. Text search,
     * sorting and column visibility belong to the shared table, the same
     * as every other list in the app. */
    filtered () {
      return this.allRows.filter((row) => {
        if (this.tab === 'yours' && row.isLibrary) return false
        if (this.tab === 'drafts' && !row.isDraft) return false
        if (this.tab === 'library' && !row.isLibrary) return false
        if (this.hideSuperseded && row.supersededBy) return false
        return true
      })
    },

    rows () {
      return this.filtered
    },

    /* Origin descending puts Local above AMRC library, so your own
     * schemas lead without a section divider the shared table cannot
     * render. The tabs do the heavier separation. */
    initialSort () {
      return [{ id: 'origin', desc: true }, { id: 'name', desc: false }]
    },

    filters () {
      return [{
        name: 'Origin',
        property: 'origin',
        options: ['Local', 'AMRC library'].map(o => ({ label: o, value: o })),
      }]
    },

    emptyDescription () {
      if (this.tab === 'drafts') return 'No schemas are being edited.'
      if (this.tab === 'yours')
        return 'Schemas describe what a machine measures. The AMRC library is loaded on '
          + 'install; anything you author here is local to this deployment.'
      return 'Nothing to show.'
    },

    selected () {
      if (!this.selectedUuid) return null
      return this.allRows.find(r => r.uuid === this.selectedUuid) ?? null
    },

    statusLine () {
      const row = this.selected
      if (!row) return ''
      if (row.isDraft)
        return row.basedOn
          ? `Version ${row.version}, not yet published`
          : 'Not yet published'
      if (row.supersededBy) return `Version ${row.version}, superseded`
      return `Version ${row.version}, published`
    },

    lineage () {
      const row = this.selected
      if (!row) return []

      const events = []

      if (row.derivedFrom) {
        events.push({
          title: 'Forked from',
          link: row.derivedFrom,
          linkLabel: this.nameFor(row.derivedFrom),
          detail: this.isLibraryUuid(row.derivedFrom) ? 'AMRC library' : 'Local schema',
        })
      }

      const replaced = this.replacedBy(row.uuid)
      if (replaced) {
        events.push({
          title: `Version ${replaced.version} published`,
          detail: replaced.usedBy
            ? `${replaced.usedBy} ${replaced.usedBy === 1 ? 'device' : 'devices'}, superseded`
            : 'Superseded',
          link: replaced.uuid,
          linkLabel: '',
        })
      }

      events.push({
        title: row.isDraft
          ? `Version ${row.version} draft`
          : `Version ${row.version} published`,
        detail: row.isDraft
          ? 'Not visible to any device yet'
          : `${row.usedBy} ${row.usedBy === 1 ? 'device' : 'devices'}`,
        current: true,
      })

      if (row.supersededBy) {
        events.push({
          title: 'Superseded by',
          link: row.supersededBy,
          linkLabel: this.nameFor(row.supersededBy),
        })
      }

      return events
    },

    usageSummary () {
      const n = this.selected?.usedBy ?? 0
      if (n === 0) return 'None'
      return n === 1 ? '1 device' : `${n} devices`
    },

    referenceSummary () {
      const n = this.selected?.referencedBy ?? 0
      if (n === 0) return 'None'
      return n === 1 ? '1 schema' : `${n} schemas`
    },
  },

  methods: {
    nameFor (uuid) {
      const entry = (this.sch.data ?? []).find(s => s.uuid === uuid)
      if (!entry) return uuid
      return `${entry.schemaInformation?.name ?? entry.name} v${versionOf(entry)}`
    },

    isLibraryUuid (uuid) {
      const entry = (this.sch.data ?? []).find(s => s.uuid === uuid)
      return entry ? isLibrarySchema(entry) : false
    },

    /* The published version this one supersedes, if any. */
    replacedBy (uuid) {
      const entry = (this.sch.data ?? []).find(s => s.uuid === uuid)
      const replaced = entry?.schemaInformation?.replaces
      if (!replaced) return null
      return this.allRows.find(r => r.uuid === replaced) ?? null
    },

    openUuid (uuid) {
      if (uuid) this.selectedUuid = uuid
    },

    newSchema () {
      this.$router.push('/schemas/new')
    },

    open () {
      if (!this.selected) return
      this.$router.push(this.selected.isDraft
        ? `/schemas/draft/${this.selected.uuid}`
        : `/schemas/${this.selected.uuid}`)
    },

    publishDraft () {
      this.$router.push(`/schemas/draft/${this.selected.uuid}/publish`)
    },

    fork () {
      window.events.emit('show-fork-schema-dialog', {
        uuid: this.selected.schemaUuid,
        name: this.selected.name,
        origin: this.selected.origin,
      })
    },

    removeDraft () {
      const draft = this.selected
      useDialog({
        title: 'Delete draft',
        message: `Delete the draft "${draft.name}"? It has not been published, so nothing is using it.`,
        confirmText: 'Delete',
        onConfirm: async () => {
          try {
            await deleteDraft(this.s.client, draft.uuid)
            toast.success('Draft deleted')
            this.selectedUuid = null
          } catch (err) {
            console.error('Failed to delete draft', err)
            toast.error('Could not delete the draft', { description: err.message })
          }
        },
      })
    },
  },

  unmounted () {
    this.sch.stop()
    this.drafts.stop()
    this.dev.stop()
  },
}
</script>
