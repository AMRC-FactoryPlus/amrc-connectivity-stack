<!--
  - ACS Admin
  - The Explorer page: the i3X Explorer, framed, using this console's session
  - Copyright 2026 University of Sheffield
  -->

<!-- The Explorer is ace-technologies-inc/i3X-Explorer, vendored in
     i3x-explorer/ (see its FORK.md) and served at /i3x-explorer/. It is
     React, so it runs in a same-origin iframe: its styles and the
     console's cannot reach each other. The host object put on window
     here gives it the i3X service URL and this session's token, so it
     never asks for a server or a sign-in, and tells the page what is
     selected, for the console's own actions above the frame. -->
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { HOST_KEY, classify_selection, mk_host } from '@/lib/i3x-explorer-host.js'
import ExplorerActions from './ExplorerActions.vue'

const router = useRouter()
const store = useServiceClientStore()
const selection = ref(null)

window[HOST_KEY] = mk_host({
  client: serviceClientReady().then(() => store.client),
  theme: () => document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  open_window: () => window.open(router.resolve('/explorer').href, '_blank', 'noopener'),
  selected: s => { selection.value = s },
})
onBeforeUnmount(() => { delete window[HOST_KEY] })

const selected = computed(() => classify_selection(selection.value))
</script>

<template>
  <!-- Fill the space under the header: main pads 1rem below, and 1rem
       above from lg up. -->
  <div class="flex flex-col gap-3 h-[calc(100vh-5rem)] lg:h-[calc(100vh-6rem)] px-4 pt-4 lg:p-0">
    <!-- A line is kept for the actions either way, so selecting an
         object does not move the Explorer down. -->
    <ExplorerActions v-if="selected" :selection="selected"/>
    <p v-else class="flex items-center min-h-9 text-sm text-gray-500">
      Select an object to monitor it, or a device or ISA-95 level to manage its i3X access.
    </p>
    <iframe
      src="/i3x-explorer/index.html"
      title="i3X Explorer"
      class="flex-1 min-h-0 w-full rounded-md border bg-white dark:bg-slate-900"/>
  </div>
</template>
