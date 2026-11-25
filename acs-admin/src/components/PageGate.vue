<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Shows a page only when the user can read it. A page whose reads
     would be refused shows "no access" instead of loading for ever,
     whether it was reached from the menu or by its address. Pages
     without a section (Home, the device page, the kiosk) always show. -->
<template>
  <div v-if="state === 'loading'" class="flex justify-center p-10 text-gray-400"
      role="status" aria-label="Checking your access">
    <i class="fa-solid fa-circle-notch animate-spin"></i>
  </div>
  <NoAccess v-else-if="state === 'denied'" :noun="noun"/>
  <slot v-else></slot>
</template>

<script>
import NoAccess from '@components/NoAccess.vue'
import { useAccessStore } from '@store/useAccessStore.js'
import { page_state, section } from '@/lib/access/sections.js'

export default {
  name: 'PageGate',

  components: {
    NoAccess,
  },

  props: {
    /* The route's meta.section, or nothing for an ungated page. */
    section: {
      type: String,
      default: null,
    },
  },

  setup () {
    return { access: useAccessStore() }
  },

  computed: {
    state () {
      return page_state(this.access.check, this.section)
    },

    noun () {
      return section(this.section)?.noun ?? 'this page'
    },
  },
}
</script>
