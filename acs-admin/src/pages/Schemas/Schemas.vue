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
  <div class="flex flex-1 flex-col min-h-0">
    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div class="flex shrink-0 items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="relative w-[260px]">
              <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center
                           pl-3 text-xs text-gray-400">
                <i class="fa-solid fa-search"></i>
              </span>
              <Input v-model="search" class="pl-8" placeholder="Search schemas..."/>
            </div>
            <Tabs v-model="tab">
              <TabsList>
                <TabsTrigger v-for="t in tabs" :key="t.value" :value="t.value">
                  {{ t.label }}
                  <span class="ml-1.5 opacity-55">{{ t.count }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" class="text-slate-500"
                @click="hideSuperseded = !hideSuperseded">
              <i class="fa-solid mr-2" :class="hideSuperseded ? 'fa-eye' : 'fa-eye-slash'"></i>
              {{ hideSuperseded ? 'Show superseded' : 'Hide superseded' }}
            </Button>
            <Button size="sm" @click="newSchema">
              <i class="fa-solid fa-plus mr-2"></i>New schema
            </Button>
          </div>
        </div>

        <Skeleton v-if="!ready" class="h-96 rounded-md"/>

        <template v-else-if="rows.length">
          <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10 bg-white">
                <tr class="border-b border-slate-200">
                  <th class="w-[34px]"></th>
                  <th class="h-12 px-4 text-left font-medium text-slate-500">Name</th>
                  <th class="h-12 w-[78px] px-4 text-left font-medium text-slate-500">
                    Version
                  </th>
                  <th class="h-12 w-[150px] px-4 text-left font-medium text-slate-500">
                    Origin
                  </th>
                  <th class="h-12 w-[96px] px-4 text-right font-medium text-slate-500">
                    Devices
                  </th>
                  <th class="h-12 w-[110px] px-4 text-right font-medium text-slate-500">
                    Used by
                  </th>
                </tr>
              </thead>
              <tbody>
                <template v-for="row in rows" :key="row.uuid ?? row.divider">
                  <tr v-if="row.divider" class="border-y border-slate-200 bg-gray-50">
                    <td colspan="6" class="px-4 py-1.5">
                      <span class="text-xs font-semibold uppercase tracking-wide
                                   text-slate-500">
                        AMRC library
                      </span>
                      <span class="ml-2.5 text-xs text-gray-400">
                        {{ row.count }} schemas. Read-only.
                      </span>
                    </td>
                  </tr>
                  <tr v-else
                      class="cursor-pointer border-b border-slate-200 transition-colors
                             hover:bg-slate-100/50"
                      :class="row.uuid === selectedUuid ? 'bg-slate-100' : ''"
                      @click="selectedUuid = row.uuid">
                    <td class="py-2 pl-4 pr-0">
                      <i class="fa-solid text-[10px]"
                          :class="[originOf(row).icon, originOf(row).colour]"
                          :title="originOf(row).label"></i>
                    </td>
                    <td class="px-4 py-2">
                      <span :class="originOf(row).name">{{ row.name }}</span>
                      <Badge v-if="row.isDraft" variant="outline"
                          class="ml-2.5 gap-1.5 border-dashed font-normal">
                        <i class="fa-solid fa-pen text-[8px]"></i>Draft
                      </Badge>
                      <Badge v-else-if="row.supersededBy" variant="secondary"
                          class="ml-2.5 font-normal text-slate-500">
                        Superseded
                      </Badge>
                    </td>
                    <td class="px-4 py-2 font-mono"
                        :class="row.supersededBy ? 'text-slate-500' : ''">
                      {{ row.isDraft ? '-' : row.version }}
                    </td>
                    <td class="px-4 py-2 text-gray-500">{{ row.origin }}</td>
                    <td class="px-4 py-2 text-right"
                        :class="row.usedBy ? '' : 'text-gray-400'">
                      {{ row.isDraft ? '-' : row.usedBy }}
                    </td>
                    <td class="px-4 py-2 text-right"
                        :class="row.referencedBy ? '' : 'text-gray-400'">
                      {{ row.isDraft ? '-' : row.referencedBy }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div class="flex shrink-0 justify-between text-xs text-gray-500">
            <span>Showing {{ visibleCount }} of {{ allRows.length }}</span>
            <span v-if="tab === 'all'">
              Yours first, then the library. Superseded rows sit under their current version.
            </span>
          </div>
        </template>

        <EmptyState v-else
            title="No schemas here"
            :description="emptyDescription"
            button-text="New schema"
            button-icon="plus"
            @button-click="newSchema"/>
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
import { Input } from '@components/ui/input'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { Tabs, TabsList, TabsTrigger } from '@components/ui/tabs'
import SidebarDetail from '@components/SidebarDetail.vue'
import EmptyState from '@components/EmptyState.vue'
import ForkDialog from '@components/Schemas/ForkDialog.vue'
import LineageTimeline from '@components/Schemas/LineageTimeline.vue'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog.js'

import { originOf } from '@/lib/schema/presentation.js'
import {
  deleteDraft, derivedFromOf, isLibrarySchema, successorIndex, versionOf,
} from '@/lib/schema/registry.js'
import { devicesUsingSchema, schemasReferencing } from '@/lib/schema/usage.js'

export default {
  name: 'Schemas',

  components: {
    Badge, Button, EmptyState, ForkDialog, Input, LineageTimeline, SidebarDetail,
    Skeleton, Tabs, TabsList, TabsTrigger,
  },

  setup () {
    return {
      selectedUuid: ref(null),
      sch: useSchemaStore(),
      drafts: useSchemaDraftStore(),
      dev: useDeviceStore(),
      s: useServiceClientStore(),
    }
  },

  data () {
    return {
      search: '',
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

    allRows () {
      const published = (this.sch.data ?? []).map(entry => ({
        uuid: entry.uuid,
        schemaUuid: entry.uuid,
        name: entry.schemaInformation?.name ?? entry.name ?? entry.uuid,
        version: versionOf(entry),
        origin: isLibrarySchema(entry) ? 'AMRC library' : 'Local',
        isLibrary: isLibrarySchema(entry),
        isDraft: false,
        usedBy: devicesUsingSchema(this.dev.data, entry.uuid).length,
        referencedBy: schemasReferencing(this.sch.data, entry.uuid).length,
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

    filtered () {
      const term = this.search.trim().toLowerCase()
      return this.allRows.filter((row) => {
        if (this.tab === 'yours' && row.isLibrary) return false
        if (this.tab === 'drafts' && !row.isDraft) return false
        if (this.tab === 'library' && !row.isLibrary) return false
        if (this.hideSuperseded && row.supersededBy) return false
        if (!term) return true
        return row.name.toLowerCase().includes(term)
          || row.uuid.toLowerCase().includes(term)
      })
    },

    /* Yours first, then the library behind a divider. Within each, a
     * superseded version sorts directly under the one that replaced it
     * rather than alphabetically away from it. */
    rows () {
      const byName = (a, b) => a.name.localeCompare(b.name) || a.version - b.version
      const local = this.filtered.filter(r => !r.isLibrary).sort(byName)
      const library = this.filtered.filter(r => r.isLibrary).sort(byName)

      const out = [...local]
      if (library.length) {
        if (local.length) out.push({ divider: true, count: library.length })
        out.push(...library)
      }
      return out
    },

    visibleCount () {
      return this.rows.filter(r => !r.divider).length
    },

    emptyDescription () {
      if (this.search) return `Nothing matches "${this.search}".`
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
    originOf,

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
