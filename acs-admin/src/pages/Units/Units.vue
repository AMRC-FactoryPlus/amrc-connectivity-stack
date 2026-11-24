<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The engineering unit vocabulary.
  -
  - Metrics keep the Eng_Unit strings they are written with. Each unit
  - here says which strings mean it: its symbol and its aliases. i3X
  - reports a metric's unit as the UNECE code of the unit its string
  - means. The second tab lists the strings in use that no unit means,
  - with what each is recognised as, so they can be added.
  -->

<template>
  <BridgesContainer>
    <Skeleton v-if="!loaded" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <Tabs v-else v-model="tab">
      <TabsContent value="units">
        <DataTableSearchable
          :columns="columns"
          :data="rows"
          :limit-height="false"
          :clickable="true"
          :filters="[]"
          :selected-objects="[]"
          :default-sort="[{ id: 'metrics', desc: true }]"
          @row-click="e => selectedUuid = e.original.uuid"
        >
          <template #toolbar-left>
            <TabsList>
              <TabsTrigger value="units">Units</TabsTrigger>
              <TabsTrigger value="unknown">Not in the vocabulary ({{ unknown.length }})</TabsTrigger>
            </TabsList>
          </template>
          <template #toolbar-right>
            <Button v-if="canAdd" class="gap-2" @click="addUnit()">
              <i class="fa-solid fa-plus"></i>
              <span>Add Unit</span>
            </Button>
          </template>
        </DataTableSearchable>
      </TabsContent>
      <TabsContent value="unknown">
        <DataTableSearchable
          :columns="unknownColumns"
          :data="unknownRows"
          :limit-height="false"
          :clickable="false"
          :filters="[]"
          :selected-objects="[]"
          :default-sort="[{ id: 'metrics', desc: true }]"
        >
          <template #toolbar-left>
            <TabsList>
              <TabsTrigger value="units">Units</TabsTrigger>
              <TabsTrigger value="unknown">Not in the vocabulary ({{ unknown.length }})</TabsTrigger>
            </TabsList>
          </template>
          <template #below-toolbar>
            <p class="text-sm text-gray-500">
              These Eng_Unit strings are in use but mean no unit, so i3X gives
              their metrics no UNECE code. Add each as a unit or an alias, or
              fix the metrics that use a wrong one.
            </p>
          </template>
        </DataTableSearchable>
      </TabsContent>
    </Tabs>

    <template v-slot:sidebar>
      <div v-if="selected && tab === 'units'" class="w-96 border-l border-border -mr-4">
        <div class="flex justify-between items-center gap-1 w-full p-4 border-b">
          <div class="flex items-center gap-2 w-full mr-3">
            <div class="flex items-center gap-2">
              <i class="fa-fw fa-solid fa-ruler"></i>
              <div class="font-semibold text-xl">Unit Details</div>
            </div>
            <Button v-if="canEdit" title="Edit Unit" size="xs" class="flex gap-1 ml-auto" @click="editUnit" variant="ghost">
              <i class="fa-solid fa-pen text-gray-400"></i>
            </Button>
            <Button v-if="canEdit && canDelete" title="Merge into..." size="xs" class="flex gap-1" @click="mergeUnit" variant="ghost">
              <i class="fa-solid fa-code-merge text-gray-400"></i>
            </Button>
            <Button v-if="canDelete" title="Delete Unit" size="xs" class="flex gap-1" @click="deleteUnit" variant="ghost">
              <i class="fa-solid fa-trash text-red-400"></i>
            </Button>
          </div>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail icon="key" label="Unit UUID" :value="selected.uuid"/>
          <SidebarDetail icon="ruler" label="Symbol" :value="selected.symbol"/>
          <SidebarDetail icon="tag" label="Name" :value="selected.name"/>
          <SidebarDetail icon="barcode" label="UNECE code" :value="selected.code"/>
          <SidebarDetail icon="tags" label="Aliases"
                         :value="selected.aliases.length ? selected.aliases.join(', ') : 'None'"/>
          <SidebarDetail icon="chart-line" label="In use"
                         :value="selected.metrics ? `${selected.metrics} metrics on ${selected.devices} devices` : 'Not used'"/>
        </div>
      </div>
    </template>

    <UnitDialog/>
    <MergeUnitDialog/>
  </BridgesContainer>
</template>

<script>
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { Button } from '@components/ui/button/index.js'
import { Skeleton } from '@components/ui/skeleton/index.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import BridgesContainer from '@components/Containers/BridgesContainer.vue'
import SidebarDetail from '@components/SidebarDetail.vue'
import UnitDialog from '@components/Units/UnitDialog.vue'
import MergeUnitDialog from '@components/Units/MergeUnitDialog.vue'
import { useDialog } from '@/composables/useDialog'
import { useServiceClientStore } from '@store/serviceClientStore'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useEngUnitStore } from '@store/useEngUnitStore.js'
import { useAccessStore } from '@store/useAccessStore.js'
import { unit_rows, unit_usage, unknown_units, with_alias } from '@/lib/eng-units.js'
import { suggest_for } from '@/lib/eng-units-unece.js'
import { unitColumns, unknownColumns } from './unitColumns.ts'

export default {
  name: 'Units',
  components: {
    BridgesContainer, Button, DataTableSearchable, MergeUnitDialog, SidebarDetail, Skeleton,
    Tabs, TabsContent, TabsList, TabsTrigger, UnitDialog,
  },

  setup () {
    return {
      tab: ref('units'),
      selectedUuid: ref(null),
      columns: unitColumns,
      s: useServiceClientStore(),
      d: useDeviceStore(),
      units: useEngUnitStore(),
      access: useAccessStore(),
    }
  },

  async mounted () {
    /* What is in use comes from every device's origin map. */
    if (!this.d.rxsub) this.d.start()
    window.events.on('unit-merged', this.onMerged)
    await this.units.start()
  },

  unmounted () {
    window.events.off('unit-merged', this.onMerged)
    this.units.stop()
  },

  computed: {
    /* Hide what the user's ACL can't do. */
    canAdd () {
      const c = this.access.check
      return c.create_in(UUIDs.Class.EngineeringUnit)
        && c.write_apps(UUIDs.App.Info, UUIDs.App.EngineeringUnit)
    },
    canEdit () {
      return this.access.check.write_apps(UUIDs.App.EngineeringUnit)
    },
    canDelete () {
      return !!this.selected && this.access.check.delete_obj(this.selected.uuid)
    },
    loaded () {
      return this.units.ready && this.d.ready
    },
    usage () {
      return unit_usage(this.d.data)
    },
    rows () {
      return unit_rows(this.units.data, this.usage)
    },
    unknown () {
      return unknown_units(this.units.data, this.usage)
    },
    unknownRows () {
      return this.unknown.map(u => ({ ...u, suggestion: suggest_for(u.string, this.units.data) }))
    },
    unknownColumns () {
      return unknownColumns(row => this.addString(row),
        row => row.suggestion?.kind === 'alias' ? this.canEdit : this.canAdd)
    },
    /* Resolve the selection from the rows so it stays live after edits. */
    selected () {
      return this.rows.find(r => r.uuid === this.selectedUuid) ?? null
    },
  },

  methods: {
    addUnit (opts) {
      window.events.emit('show-unit-dialog', opts)
    },
    editUnit () {
      this.addUnit({ unit: this.units.by_uuid(this.selectedUuid) })
    },
    mergeUnit () {
      window.events.emit('show-unit-merge-dialog', this.units.by_uuid(this.selectedUuid))
    },
    onMerged (uuid) {
      this.selectedUuid = uuid ?? null
    },

    /* Act on a string no unit means, as the page suggests. */
    addString (row) {
      const s = row.suggestion
      if (s?.kind === 'create')
        return this.addUnit({ config: s.config, name: s.name })
      if (s?.kind !== 'alias')
        return this.addUnit({ alias: row.string })
      const unit = s.unit
      useDialog({
        title: 'Add Alias',
        message: `Add "${row.string}" as an alias of ${unit.symbol}, ${unit.name} (${unit.code})? The ${row.metrics} metric${row.metrics === 1 ? '' : 's'} written that way will mean this unit.`,
        confirmText: 'Add Alias',
        onConfirm: async () => {
          try {
            await this.s.client.ConfigDB.put_config(UUIDs.App.EngineeringUnit, unit.uuid,
              with_alias(unit, row.string))
            toast.success(`"${row.string}" now means ${unit.symbol}`)
          }
          catch (err) {
            console.error('Failed to add alias:', err)
            toast.error('Failed to add alias', {
              description: err.message || 'An unexpected error occurred',
            })
          }
        },
      })
    },

    deleteUnit () {
      const unit = this.selected
      const used = unit.metrics
        ? ` ${unit.metrics} metric${unit.metrics === 1 ? ' is' : 's are'} written with it. They keep their Eng_Unit, but i3X will give them no UNECE code.`
        : ' No metric is written with it.'
      useDialog({
        title: 'Delete Unit',
        message: `Delete ${unit.symbol}, ${unit.name} (${unit.code}), from the vocabulary?${used} You cannot undo this.`,
        confirmText: 'Delete',
        onConfirm: async () => {
          try {
            await this.s.client.ConfigDB.delete_object(unit.uuid)
            toast.success(`Deleted ${unit.symbol}`)
            this.selectedUuid = null
          }
          catch (err) {
            console.error('Failed to delete unit:', err)
            toast.error('Failed to delete unit', {
              description: err.message || 'An unexpected error occurred',
            })
          }
        },
      })
    },
  },
}
</script>
