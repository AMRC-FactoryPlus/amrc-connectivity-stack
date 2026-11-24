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
     never asks for a server or a sign-in, and offers this console's own
     actions on the selected object, which the app shows beside its
     Subscribe button: Manage access opens the access dialog here, and
     Build dataset opens the dataset builder. -->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { useLayoutStore } from '@store/layoutStore.js'
import { HOST_KEY, classify_selection, explorer_actions, location_query, mk_host, query_location } from '@/lib/i3x-explorer-host.js'
import { on_explorer_search } from '@/lib/explorer-search.js'
import I3xAccessButton from '@components/Access/I3xAccessButton.vue'

const router = useRouter()
const route = useRoute()
const store = useServiceClientStore()
/* Full screen (Esc) hides the console's menu and header; the Explorer
 * then fills the whole window with no frame around it. */
const layout = useLayoutStore()
const isa95 = useISA95Store()
onMounted(() => isa95.start())

/* Device access names the levels above the device, and level access
 * needs the level's vocabulary node, so both wait for the vocabulary. */
function isa95_ready () {
  if (isa95.ready) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(() => isa95.ready, ready => {
      if (!ready) return
      stop()
      resolve()
    })
  })
}

/* The props of the access dialog open now, or null. */
const access = ref(null)
const accessOpen = ref(false)
watch(accessOpen, open => { if (!open) access.value = null })

const frame = ref(null)
let stop_search = null

/* The URL names the Explorer's selected object and tab
 * (?object=…&tab=history), so a link opens the same place. The app
 * reports each move and the URL is replaced, not pushed: the app keeps
 * its own history. A URL changed from outside (a link elsewhere in the
 * console to this page) moves the app. */
const same_location = (a, b) => a.object === b.object && a.tab === b.tab
let go_location = null
watch(() => route.query, query => {
  if (route.path !== '/explorer') return
  const loc = query_location(query)
  go_location?.(loc)
})

window[HOST_KEY] = mk_host({
  client: serviceClientReady().then(() => store.client),
  theme: () => document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  open_window: () => window.open(router.resolve('/explorer').href, '_blank', 'noopener'),
  async actions (selection) {
    await isa95_ready()
    return explorer_actions(classify_selection(selection), isa95.data)
  },
  /* ⌘K outside the frame: focus the frame so the search box can take
   * the keyboard, then let the app open its search. */
  on_search (open) {
    stop_search?.()
    stop_search = on_explorer_search(() => {
      frame.value?.contentWindow?.focus()
      open()
    })
    return () => stop_search?.()
  },
  escape: () => layout.toggleFullscreen(),
  location: () => query_location(route.query),
  set_location (loc) {
    if (route.path !== '/explorer' || same_location(loc, query_location(route.query))) return
    router.replace({ query: location_query(loc, route.query) })
  },
  on_location (go) {
    go_location = go
    return () => { if (go_location === go) go_location = null }
  },
  run (action) {
    if (action.access) {
      access.value = action.access
      accessOpen.value = true
    }
    else if (action.route) router.push(action.route)
  },
})
onBeforeUnmount(() => {
  stop_search?.()
  delete window[HOST_KEY]
})
</script>

<template>
  <!-- Fill the space under the header: main pads 1rem below, and 1rem
       above from lg up. In full screen, fill the whole window edge to edge. -->
  <div :class="layout.fullscreen
         ? 'fixed inset-0 z-30 flex flex-col bg-white dark:bg-slate-900'
         : 'flex flex-col h-[calc(100vh-5rem)] lg:h-[calc(100vh-6rem)] px-4 pt-4 lg:p-0'">
    <iframe
      ref="frame"
      src="/i3x-explorer/index.html"
      title="i3X Explorer"
      :class="['flex-1 min-h-0 w-full bg-white dark:bg-slate-900', layout.fullscreen ? '' : 'rounded-md border']"/>
    <I3xAccessButton v-if="access" :key="access.target" headless v-model:open="accessOpen"
                     :target="access.target" :device="access.device" :via="access.via"
                     :noun="access.noun" :name="access.name" :path="access.path"/>
  </div>
</template>
