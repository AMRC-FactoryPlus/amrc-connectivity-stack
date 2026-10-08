<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Tag chips for the kiosk: a 56px field that adds a tag on Enter or
     comma, and one-tap buttons for suggested tags. Emits `update` with
     the whole new list. -->
<template>
  <div class="flex flex-col gap-2">
    <label :for="id" class="text-[15px] font-medium text-slate-900">
      Tags <span v-if="optional" class="font-normal text-gray-400">optional</span>
    </label>
    <div class="flex min-h-14 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-slate-950 focus-within:ring-offset-2">
      <span v-for="t in tags" :key="t" class="inline-flex items-center gap-1 rounded bg-slate-100 py-1 pl-2.5 text-sm text-slate-700">
        {{ t }}
        <button type="button" class="flex h-8 w-8 items-center justify-center text-slate-500 hover:text-slate-900"
                :aria-label="`Remove tag ${t}`" :disabled="disabled" @click="remove(t)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </span>
      <input :id="id" v-model="draft" :disabled="disabled" :placeholder="placeholder" enterkeyhint="done"
             class="h-10 min-w-[120px] flex-1 border-0 bg-transparent text-base outline-none"
             @keydown.enter.prevent="commit" @keydown="e => e.key === ',' && (e.preventDefault(), commit())" @blur="commit"/>
    </div>
    <div v-if="suggestions.length" class="flex flex-wrap gap-1.5">
      <button v-for="t in suggestions" :key="t" type="button" :disabled="disabled"
              class="h-11 rounded-md bg-white px-3.5 text-[15px] ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-50"
              @click="emit('update', [...tags, t])">
        + {{ t }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { normalise_tags } from '@/lib/datasets/model.js'

const props = defineProps({
  tags: { type: Array, default: () => [] },
  suggestions: { type: Array, default: () => [] },
  optional: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: 'Add a tag' },
  id: { type: String, default: 'kiosk-tags' },
})
const emit = defineEmits(['update'])

const draft = ref('')

function commit () {
  const v = draft.value.trim()
  draft.value = ''
  if (!v) return
  emit('update', normalise_tags([...props.tags, v]))
}

function remove (t) {
  emit('update', props.tags.filter(x => x !== t))
}
</script>
