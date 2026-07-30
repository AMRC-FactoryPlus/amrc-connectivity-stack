<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Where a schema came from and what became of it.
  -
  - Forking gives a schema a new name and restarts its version history,
  - so the name no longer carries the ancestry. This is where it lives
  - instead.
  -->

<template>
  <div class="flex flex-col">
    <div v-for="(event, i) in events" :key="i" class="flex gap-2.5">
      <div class="flex w-2.5 shrink-0 flex-col items-center">
        <i class="fa-solid fa-circle mt-[5px] text-[6px]"
            :class="event.current ? 'text-slate-900' : 'text-slate-300'"></i>
        <div v-if="i < events.length - 1" class="w-px flex-1 bg-slate-200"></div>
      </div>
      <div :class="i < events.length - 1 ? 'pb-3' : ''">
        <div class="flex flex-wrap items-baseline gap-x-1 text-sm"
            :class="event.current ? 'font-medium' : 'text-slate-500'">
          <span>{{ event.title }}</span>
          <button v-if="event.link && event.linkLabel"
              class="text-slate-950 hover:underline"
              @click="$emit('open', event.link)">
            {{ event.linkLabel }}
          </button>
        </div>
        <div v-if="event.detail" class="text-xs text-gray-400">{{ event.detail }}</div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LineageTimeline',

  props: {
    /* [{ title, detail, current, link, linkLabel }] oldest first. */
    events: { type: Array, required: true },
  },

  emits: ['open'],
}
</script>
