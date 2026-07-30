<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <BridgesContainer>
    <Skeleton v-if="!ready" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <DataTableSearchable v-else
        :columns="columns"
        :data="rows"
        :limit-height="false"
        :clickable="true"
        :filters="filters"
        :selected-objects="[]"
        :default-sort="initialSort"
        @row-click="e => select(e.original)">
      <template #toolbar-right>
        <Button class="gap-2" @click="newSchema">
          <i class="fa-solid fa-plus"></i>
          <span>New Schema</span>
        </Button>
      </template>
      <template #empty>
        <EmptyState
            title="No schemas"
            description="Schemas describe what a machine measures. The AMRC library is loaded on install; anything you author here is local to this deployment."
            button-text="New Schema"
            button-icon="plus"
            @button-click="newSchema"/>
      </template>
    </DataTableSearchable>

    <template v-slot:sidebar>
      <div v-if="selected" class="w-96 border-l border-border -mr-4 overflow-y-auto">
        <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
          <div class="flex items-center gap-2 w-full mr-3">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-diagram-project"></i>
              <div class="font-semibold text-xl">Schema</div>
            </div>
            <Button v-if="selected.isDraft" title="Delete draft" size="xs"
                class="flex gap-1 ml-auto" variant="ghost" @click="removeDraft">
              <i class="fa-solid fa-trash text-red-400"></i>
            </Button>
          </div>
        </div>

        <div class="space-y-4 p-4">
          <SidebarDetail icon="tag" label="Name" :value="selected.name"/>
          <SidebarDetail icon="key" label="UUID" :value="selected.uuid"/>
          <SidebarDetail icon="code-branch" label="Version"
              :value="selected.isDraft ? 'Not published' : `v${selected.version}`"/>
          <SidebarDetail icon="box" label="Origin" :value="selected.origin"/>
          <SidebarDetail v-if="derivedFromName" icon="code-fork"
              label="Forked from" :value="derivedFromName"/>
          <SidebarDetail v-if="supersededByName" icon="arrow-right"
              label="Superseded by" :value="supersededByName"/>
          <SidebarDetail v-if="!selected.isDraft" icon="microchip"
              label="Devices using this" :value="usageSummary"/>
          <SidebarDetail v-if="!selected.isDraft" icon="cubes"
              label="Used in schemas" :value="referenceSummary"/>
        </div>

        <div class="flex flex-col gap-2 p-4 border-t">
          <Button v-if="selected.isDraft" @click="open">
            <i class="fa-solid fa-pen mr-2"></i>Continue editing
          </Button>
          <template v-else>
            <Button v-if="selected.origin === 'AMRC library'" @click="fork">
              <i class="fa-solid fa-code-fork mr-2"></i>Make a local copy
            </Button>
            <Button v-else @click="open">
              <i class="fa-solid fa-pen mr-2"></i>Edit
            </Button>
            <Button variant="outline" @click="fork">
              <i class="fa-solid fa-code-fork mr-2"></i>Fork as a new schema
            </Button>
          </template>
        </div>

        <p v-if="selected.origin === 'AMRC library'"
            class="px-4 pb-4 text-xs text-gray-500">
          This schema comes from the AMRC library. Editing creates a local copy.
        </p>
      </div>
    </template>

    <ForkDialog/>
  </BridgesContainer>
</template>

<script>
import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { Button } from '@components/ui/button'
import { Skeleton } from '@components/ui/skeleton/index.js'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import BridgesContainer from '@components/Containers/BridgesContainer.vue'
import SidebarDetail from '@components/SidebarDetail.vue'
import EmptyState from '@components/EmptyState.vue'
import ForkDialog from '@components/Schemas/ForkDialog.vue'

import { schemaColumns } from './schemaColumns.ts'
import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog.js'
import {
  deleteDraft,
  derivedFromOf,
  isLibrarySchema,
  successorIndex,
  versionOf,
} from '@/lib/schema/registry.js'
import { devicesUsingSchema, schemasReferencing } from '@/lib/schema/usage.js'

export default {
  name: 'Schemas',

  components: {
    BridgesContainer,
    Button,
    DataTableSearchable,
    EmptyState,
    ForkDialog,
    SidebarDetail,
    Skeleton,
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

  async mounted () {
    await Promise.all([
      this.sch.start(),
      this.drafts.start(),
      this.dev.start(),
    ])
  },

  computed: {
    ready () {
      return this.sch.ready && this.drafts.ready
    },

    successors () {
      return successorIndex(this.sch.data)
    },

    rows () {
      const published = (this.sch.data ?? []).map(entry => ({
        uuid: entry.uuid,
        name: entry.schemaInformation?.name ?? entry.name ?? entry.uuid,
        version: versionOf(entry),
        origin: isLibrarySchema(entry) ? 'AMRC library' : 'Local',
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
          name: entry.draft.name,
          version: entry.draft.version ?? 1,
          origin: 'Draft',
          isDraft: true,
          usedBy: 0,
          referencedBy: 0,
          supersededBy: null,
          derivedFrom: entry.draft.derivedFrom ?? null,
        }))

      return [...drafts, ...published]
    },

    filters () {
      return [{
        name: 'Origin',
        property: 'origin',
        options: ['Draft', 'Local', 'AMRC library']
          .map(o => ({ label: o, value: o })),
      }]
    },

    initialSort () {
      return [{ id: 'name', desc: false }]
    },

    selected () {
      if (!this.selectedUuid) return null
      return this.rows.find(r => r.uuid === this.selectedUuid) ?? null
    },

    nameFor () {
      return (uuid) => {
        const entry = this.sch.data?.find(s => s.uuid === uuid)
        if (!entry) return uuid
        return `${entry.schemaInformation?.name ?? entry.name} (v${versionOf(entry)})`
      }
    },

    derivedFromName () {
      return this.selected?.derivedFrom ? this.nameFor(this.selected.derivedFrom) : null
    },

    supersededByName () {
      return this.selected?.supersededBy ? this.nameFor(this.selected.supersededBy) : null
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
    select (row) {
      this.selectedUuid = row?.uuid ?? null
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

    fork () {
      window.events.emit('show-fork-schema-dialog', {
        uuid: this.selected.uuid,
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
            toast.error('Could not delete the draft', {
              description: err.message,
            })
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
