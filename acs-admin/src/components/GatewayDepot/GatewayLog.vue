<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The gateway's setup log. It follows new lines unless the person
     has scrolled up to read. The log is untrusted text, so it only ever
     goes into text nodes. -->
<template>
  <div>
    <div v-show="text" class="relative">
      <pre ref="pre" tabindex="0" role="region" aria-label="Gateway log"
          class="m-0 h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-[1.125rem]"
          @scroll="on_scroll"></pre>
      <Button v-if="more" variant="outline" size="sm" class="absolute bottom-3 right-4 shadow-lg" @click="to_end">New lines below</Button>
    </div>
    <p v-if="!text" class="text-sm text-slate-500">The gateway has not sent any log lines yet.</p>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps({
  text: { type: String, default: '' },
})

const pre = ref(null)
const more = ref(false)
let last = ''
let stick = true

const at_end = el => el.scrollHeight - el.scrollTop - el.clientHeight < 24

function on_scroll () {
  stick = at_end(pre.value)
  if (stick) more.value = false
}

function to_end () {
  pre.value.scrollTop = pre.value.scrollHeight
  stick = true
  more.value = false
  pre.value.focus()
}

function update (text) {
  const el = pre.value
  if (!el || text === last) return
  /* Append when the log only grew, so a selection in the older lines survives. */
  if (last && text.startsWith(last)) el.append(text.slice(last.length))
  else el.textContent = text
  last = text
  /* The box is hidden while there is no log, and has no height to scroll until it shows. */
  nextTick(() => {
    if (stick) el.scrollTop = el.scrollHeight
    else more.value = true
  })
}

onMounted(() => update(props.text))
watch(() => props.text, update)
</script>
