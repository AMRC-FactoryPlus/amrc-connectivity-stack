<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Tag chips. With `editable`, each chip has a remove button and an
     inline input adds tags (Enter or comma). Emits `update` with the
     whole new list; the parent saves it. -->
<template>
  <div class="flex flex-wrap items-center gap-1">
    <span v-for="t in tags" :key="t"
          class="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
      <span>#{{ t }}</span>
      <button v-if="editable" type="button" class="text-slate-400 hover:text-slate-900"
              :aria-label="`Remove tag ${t}`" @click="remove(t)">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>
    <template v-if="editable">
      <input v-if="adding" ref="input" v-model="draft" :list="listId"
             class="h-6 w-28 rounded border border-slate-200 px-1.5 text-xs outline-none focus:ring-2 focus:ring-slate-950"
             placeholder="Tag" @keydown.enter.prevent="commit" @keydown.esc="cancel"
             @keydown="e => e.key === ',' && (e.preventDefault(), commit())" @blur="commit"/>
      <button v-else type="button" class="text-xs text-slate-500 hover:text-slate-900" @click="open">
        <i class="fa-solid fa-plus"></i> Add tag
      </button>
      <datalist :id="listId">
        <option v-for="s in suggestions" :key="s" :value="s"/>
      </datalist>
    </template>
  </div>
</template>

<script setup>
import { ref, nextTick, computed } from 'vue'
import { normalise_tags } from '@/lib/datasets/model.js'

const props = defineProps({
  tags: { type: Array, default: () => [] },
  editable: { type: Boolean, default: false },
  known: { type: Array, default: () => [] },
})
const emit = defineEmits(['update'])

const adding = ref(false)
const draft = ref('')
const input = ref(null)
const listId = `tag-suggestions-${Math.random().toString(36).slice(2)}`

const suggestions = computed(() => props.known.filter(t => !props.tags.includes(t)).slice(0, 20))

async function open () {
  adding.value = true
  await nextTick()
  input.value?.focus()
}

function commit () {
  const v = draft.value.replace(/^#/, '').trim()
  if (v) emit('update', normalise_tags([...props.tags, v]))
  draft.value = ''
  adding.value = false
}

function cancel () {
  draft.value = ''
  adding.value = false
}

function remove (t) {
  emit('update', props.tags.filter(x => x !== t))
}
</script>
