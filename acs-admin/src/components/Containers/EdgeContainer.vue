<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col -m-4">
    <EdgeBreadcrumbs/>
    <div class="m-4">
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