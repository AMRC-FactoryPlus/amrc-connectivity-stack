<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col -m-4 flex-1">
    <div class="flex justify-between bg-white sticky top-[-1rem] border-b z-10">
      <EdgeBreadcrumbs/>
      <slot name="header"></slot>
    </div>
    <div class="m-4 flex-1 h-full">
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

  setup () {
    return {}
  },
}
</script>