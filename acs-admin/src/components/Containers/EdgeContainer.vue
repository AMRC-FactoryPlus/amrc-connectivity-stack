<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col -m-4">
    <div class="flex justify-between bg-white sticky top-[-1rem] border-b mb-4 z-10">
      <EdgeBreadcrumbs/>
      <slot name="header"></slot>
    </div>
    <div class="m-4 ">
      <slot></slot>
    </div>
  </div>
</template>

<script>
import EdgeBreadcrumbs from '@components/Nav/EdgeBreadcrumbs.vue'

export default {

  name: 'EdgeContainer',
  components: { EdgeBreadcrumbs },

  setup () {
    return {}
  },
}
</script>