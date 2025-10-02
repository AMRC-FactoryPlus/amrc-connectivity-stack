<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col h-[calc(100vh-64px)] -m-4">
    <div class="flex justify-between bg-white sticky top-[-1rem] border-b z-10">
      <EdgeBreadcrumbs/>
      <slot name="header"></slot>
    </div>
    <div class="flex-1 overflow-hidden" :class="[padding]">
      <slot></slot>
    </div>
  </div>
</template>

<script>
import EdgeBreadcrumbs from '@components/Nav/EdgeBreadcrumbs.vue'

export default {

  name: 'EdgeContainer',
  components: {
    EdgeBreadcrumbs,
  },

  props: {
    padding: { type: String, default: 'p-4' },
  },

  setup () {
    return {}
  },
}
</script>