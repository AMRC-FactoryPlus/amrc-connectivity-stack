<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Choosing a schema, as a list rather than a dropdown.
  -
  - A deployment has hundreds of schemas and a native select gives you a
  - scrolling column of names and nothing else. This is the same surface
  - as the Schemas page, cut down: search, the same tabs, and the columns
  - that tell you whether a schema is yours, how many devices already use
  - it, and whether something newer has replaced it.
  -->

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3
                     text-xs text-gray-400">
          <i class="fa-solid fa-search"></i>
        </span>
        <Input v-model="search" class="pl-8" placeholder="Search schemas..." autofocus/>
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

    <!-- Only offered once something in the deployment is marked.
         Before then there is nothing to hide and the choice would be
         meaningless. -->
    <label v-if="canFilterTopLevel"
        class="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
      <Checkbox :model-value="showAll" @update:model-value="v => showAll = v === true"/>
      <span>Show schemas that are parts of a machine</span>
    </label>

    <div class="h-80 overflow-y-auto rounded-md border border-slate-200">
      <table class="w-full text-sm">
        <tbody>
          <tr v-for="row in rows" :key="row.uuid"
              class="cursor-pointer border-b border-slate-200 last:border-b-0
                     transition-colors hover:bg-slate-100/50"
              :class="row.uuid === modelValue ? 'bg-slate-100' : ''"
              @click="$emit('update:modelValue', row.uuid)">
            <td class="w-[34px] py-2 pl-3 pr-0 align-middle">
              <i class="fa-solid text-[10px]" :class="[row.glyph.icon, row.glyph.colour]"
                  :title="row.glyph.label"></i>
            </td>
            <td class="py-2 pr-3">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ row.name }}</span>
                <Badge v-if="row.supersededBy" variant="secondary"
                    class="shrink-0 font-normal text-slate-500">Superseded</Badge>
                <i v-if="row.uuid === modelValue"
                    class="fa-solid fa-check ml-auto text-xs text-slate-900"></i>
              </div>
              <div class="text-xs text-gray-400">
                v{{ row.version }} · {{ row.origin }}
              </div>
            </td>
            <td class="w-[110px] py-2 pr-4 text-right align-middle">
              <div class="text-sm" :class="row.usedBy ? '' : 'text-gray-400'">
                {{ row.usedBy }}
              </div>
              <div class="text-[10px] text-gray-400">
                {{ row.usedBy === 1 ? 'device' : 'devices' }}
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="3" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ search ? `Nothing matches "${search}".` : 'Nothing to show.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex justify-between text-xs text-gray-500">
      <span>
        Showing {{ rows.length }} of {{ allRows.length }}<template
            v-if="hiddenCount">, {{ hiddenCount }} hidden</template>
      </span>
      <span v-if="newerAvailable" class="text-gray-500">
        <i class="fa-solid fa-circle-arrow-up mr-1.5 text-[11px] text-slate-400"></i>
        A newer version of this schema exists
      </span>
    </div>
  </div>
</template>

<script>
import { Badge } from '@components/ui/badge'
import { Checkbox } from '@components/ui/checkbox'
import { Input } from '@components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@components/ui/tabs'

import { originOf } from '@/lib/schema/presentation.js'
import {
  anyTopLevelMarked, isLibrarySchema, successorIndex, topLevelOf, versionOf,
} from '@/lib/schema/registry.js'
import { buildUsageIndex } from '@/lib/schema/usage.js'

export default {
  name: 'SchemaPicker',

  components: { Badge, Checkbox, Input, Tabs, TabsList, TabsTrigger },

  props: {
    modelValue: { type: String, default: null },
    schemas: { type: Array, default: () => [] },
    devices: { type: Array, default: () => [] },
    /* Only the newest version of each name, which is what choosing a
     * schema for a device almost always wants. */
    latestOnly: { type: Boolean, default: false },
  },

  emits: ['update:modelValue'],

  data () {
    return { search: '', tab: 'all', showAll: false }
  },

  computed: {
    successors () {
      return successorIndex(this.schemas)
    },

    /* Until the library ships marked schemas nothing carries the flag,
     * and filtering on it would empty the list. */
    canFilterTopLevel () {
      return anyTopLevelMarked(this.schemas)
    },

    /* Built once over the whole store rather than once per row. */
    usage () {
      return buildUsageIndex(this.schemas, this.devices)
    },

    allRows () {
      const rows = (this.schemas ?? []).map((entry) => {
        const row = {
          uuid: entry.uuid,
          name: entry.schemaInformation?.name ?? entry.name ?? entry.uuid,
          version: versionOf(entry),
          origin: isLibrarySchema(entry) ? 'AMRC library' : 'Local',
          isLibrary: isLibrarySchema(entry),
          usedBy: this.usage.devices.get(entry.uuid) ?? 0,
          supersededBy: this.successors.get(entry.uuid)?.uuid ?? null,
          topLevel: topLevelOf(entry),
        }
        row.glyph = originOf(row)
        return row
      })

      if (!this.latestOnly) return rows

      /* Keep the highest version of each name, plus whatever is
       * currently selected so a device on an old version still shows
       * what it is on. */
      const best = new Map()
      for (const row of rows) {
        const seen = best.get(row.name)
        if (!seen || row.version > seen.version) best.set(row.name, row)
      }
      const kept = new Set([...best.values()].map(r => r.uuid))
      return rows.filter(r => kept.has(r.uuid) || r.uuid === this.modelValue)
    },

    tabs () {
      return [
        { value: 'all', label: 'All', count: this.allRows.length },
        { value: 'yours', label: 'Yours', count: this.allRows.filter(r => !r.isLibrary).length },
        { value: 'library', label: 'Library', count: this.allRows.filter(r => r.isLibrary).length },
      ]
    },

    rows () {
      const term = this.search.trim().toLowerCase()
      return this.allRows
        .filter((row) => {
          if (this.tab === 'yours' && row.isLibrary) return false
          if (this.tab === 'library' && !row.isLibrary) return false
          /* An unmarked schema is not hidden: it predates the flag
           * rather than having been declared a component. The schema a
           * device is already on is always shown. */
          if (this.canFilterTopLevel && !this.showAll
            && row.topLevel === false && row.uuid !== this.modelValue) return false
          if (!term) return true
          return row.name.toLowerCase().includes(term)
            || row.uuid.toLowerCase().includes(term)
        })
        .sort((a, b) => {
          /* Yours first: at a customer site the local schemas are the
           * few that matter and the library is the haystack. */
          if (a.isLibrary !== b.isLibrary) return a.isLibrary ? 1 : -1
          return a.name.localeCompare(b.name) || a.version - b.version
        })
    },

    hiddenCount () {
      if (!this.canFilterTopLevel || this.showAll) return 0
      return this.allRows.filter(r => r.topLevel === false).length
    },

    newerAvailable () {
      const selected = this.allRows.find(r => r.uuid === this.modelValue)
      return !!selected?.supersededBy
    },
  },
}
</script>
