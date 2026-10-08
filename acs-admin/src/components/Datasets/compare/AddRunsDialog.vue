<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pick more runs to compare. Lists runs with a start and an end that
     are not already in the comparison. Emits `add` with UUIDs. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Add runs</DialogTitle>
        <DialogDescription>Choose runs to add to the comparison.</DialogDescription>
      </DialogHeader>

      <Input v-model="search" placeholder="Search names and tags..." aria-label="Search runs"/>

      <ul class="max-h-80 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
        <li v-for="r in candidates" :key="r.uuid">
          <label class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-100">
            <Checkbox :model-value="chosen.has(r.uuid)" @update:model-value="v => toggle(r.uuid, v)"/>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium" :title="display_name(r)">{{ display_name(r) }}</span>
              <span class="block text-xs text-slate-500">{{ fmt_window(r.from, r.to) }}</span>
            </span>
          </label>
        </li>
        <li v-if="!candidates.length" class="px-3 py-6 text-center text-sm text-slate-500">
          No other runs match.
        </li>
      </ul>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
        <Button :disabled="!chosen.size" @click="add">
          Add {{ chosen.size || '' }} {{ chosen.size === 1 ? 'run' : 'runs' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { display_name, fmt_window, matches } from '@/lib/datasets/model.js'
import { is_finished_run } from '@/lib/datasets/compare.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  exclude: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'add'])
const ds = useDatasetsStore()

const search = ref('')
const chosen = reactive(new Set())

watch(() => props.open, v => {
  if (v) { search.value = ''; chosen.clear() }
})

const candidates = computed(() => ds.all
  .filter(r => is_finished_run(r) && !props.exclude.includes(r.uuid) && matches(r, search.value))
  .sort((a, b) => Date.parse(b.from) - Date.parse(a.from))
  .slice(0, 200))

function toggle (uuid, on) {
  if (on) chosen.add(uuid)
  else chosen.delete(uuid)
}

function add () {
  emit('add', [...chosen])
  emit('update:open', false)
}
</script>
