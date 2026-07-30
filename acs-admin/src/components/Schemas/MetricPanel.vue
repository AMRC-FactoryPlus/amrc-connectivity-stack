<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col gap-5 max-w-2xl">
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">Name</label>
      <Input :model-value="node.key" :disabled="readonly"
          @update:model-value="rename"/>
      <p v-if="keyError" class="text-xs text-red-500">{{ keyError }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">Sparkplug type</label>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="type in types" :key="type"
            class="rounded-md border px-2 py-1 text-xs"
            :class="selectedTypes.includes(type)
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white hover:bg-gray-50 border-gray-200'"
            :disabled="readonly"
            @click="toggleType(type)">
          {{ type }}
        </button>
      </div>
      <p class="text-xs text-gray-500">
        Pick more than one where a device may report either width.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">Documentation</label>
      <Input :model-value="text('Documentation')" :disabled="readonly"
          placeholder="What this measures"
          @update:model-value="v => setField('Documentation', v)"/>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Unit</label>
        <Input :model-value="text('Eng_Unit')" :disabled="readonly"
            placeholder="e.g. mm/min"
            @update:model-value="v => setField('Eng_Unit', v)"/>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Low</label>
        <Input :model-value="text('Eng_Low')" :disabled="readonly" type="number"
            @update:model-value="v => setNumber('Eng_Low', v)"/>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">High</label>
        <Input :model-value="text('Eng_High')" :disabled="readonly" type="number"
            @update:model-value="v => setNumber('Eng_High', v)"/>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <Switch :model-value="historian" :disabled="readonly"
          @update:model-value="v => setField('Record_To_Historian', v)"/>
      <label class="text-sm font-medium">Record to historian</label>
    </div>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'

import { SPARKPLUG_TYPES } from '@/lib/schema/constants.js'

export default {
  name: 'MetricPanel',

  components: { Input, Switch },

  props: {
    node: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
    keyError: { type: String, default: null },
  },

  emits: ['rename', 'change'],

  computed: {
    types () {
      return SPARKPLUG_TYPES
    },

    selectedTypes () {
      return this.node.fields?.Sparkplug_Type ?? []
    },

    historian () {
      return this.node.fields?.Record_To_Historian ?? true
    },
  },

  methods: {
    rename (value) {
      this.$emit('rename', value)
    },

    text (name) {
      const value = this.node.fields?.[name]
      return value === undefined || value === null ? '' : String(value)
    },

    /* An empty box means the field is gone, not that it is an empty
     * string. The model keeps '' and null as real values because the
     * library uses both, so the panel is where a cleared box turns into
     * a deletion. */
    setField (name, value) {
      if (value === '' || value === undefined || value === null)
        delete this.node.fields[name]
      else
        this.node.fields[name] = value
      this.$emit('change')
    },

    setNumber (name, value) {
      if (value === '' || value === undefined || value === null) {
        delete this.node.fields[name]
      } else {
        const n = Number(value)
        if (Number.isNaN(n)) return
        this.node.fields[name] = n
      }
      this.$emit('change')
    },

    toggleType (type) {
      if (this.readonly) return
      const current = this.node.fields.Sparkplug_Type ?? []
      this.node.fields.Sparkplug_Type = current.includes(type)
        ? current.filter(t => t !== type)
        : [...current, type]
      this.$emit('change')
    },
  },
}
</script>
