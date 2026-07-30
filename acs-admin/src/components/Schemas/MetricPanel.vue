<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="grid grid-cols-2 gap-x-5 gap-y-[18px] content-start">
    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Name</label>
      <Input class="font-mono" :model-value="node.key" :disabled="readonly"
          @update:model-value="v => $emit('rename', v)"/>
      <p v-if="keyError" class="text-xs text-red-500">{{ keyError }}</p>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Unit</label>
      <Input :model-value="text('Eng_Unit')" :disabled="readonly"
          placeholder="e.g. mm/min"
          @update:model-value="v => set('Eng_Unit', v)"/>
    </div>

    <div class="col-span-2">
      <TypeSelector :model-value="node.fields?.Sparkplug_Type ?? []"
          :disabled="readonly"
          @update:model-value="setTypes"/>
    </div>

    <div class="col-span-2 flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Documentation</label>
      <textarea
          class="flex h-16 w-full resize-none rounded-md border border-slate-200 bg-white
                 px-3 py-2 text-sm placeholder:text-slate-500
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950
                 focus-visible:ring-offset-2 disabled:opacity-50"
          :value="text('Documentation')"
          :disabled="readonly"
          placeholder="What this measures, and anything a reader would need to know."
          @input="e => set('Documentation', e.target.value)"></textarea>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Range low</label>
      <Input class="font-mono" type="number" :model-value="text('Eng_Low')"
          :disabled="readonly" @update:model-value="v => setNumber('Eng_Low', v)"/>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Range high</label>
      <Input class="font-mono" type="number" :model-value="text('Eng_High')"
          :disabled="readonly" @update:model-value="v => setNumber('Eng_High', v)"/>
    </div>

    <div class="col-span-2 flex items-center justify-between border-t border-slate-200 pt-4">
      <div>
        <div class="text-sm font-medium">Record to historian</div>
        <div class="text-xs text-gray-500">
          Values are stored and queryable in Explorer.
        </div>
      </div>
      <Switch :model-value="historian" :disabled="readonly"
          @update:model-value="v => set('Record_To_Historian', v)"/>
    </div>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'

import TypeSelector from './TypeSelector.vue'

export default {
  name: 'MetricPanel',

  components: { Input, Switch, TypeSelector },

  props: {
    node: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
    keyError: { type: String, default: null },
  },

  emits: ['rename', 'change'],

  computed: {
    historian () {
      return this.node.fields?.Record_To_Historian ?? true
    },
  },

  methods: {
    text (name) {
      const value = this.node.fields?.[name]
      return value === undefined || value === null ? '' : String(value)
    },

    /* An empty box means the field is gone, not that it is an empty
     * string. The model keeps '' and null as real values because the
     * schema library uses both, so the panel is where a cleared box
     * turns into a deletion. */
    set (name, value) {
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

    setTypes (types) {
      if (!types.length) delete this.node.fields.Sparkplug_Type
      else this.node.fields.Sparkplug_Type = types
      this.$emit('change')
    },
  },
}
</script>
