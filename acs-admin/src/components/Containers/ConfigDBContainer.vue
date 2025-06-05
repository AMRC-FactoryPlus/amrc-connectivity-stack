<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col h-[calc(100vh-64px)] -m-4">
    <div class="flex justify-between bg-white sticky top-[-1rem] border-b z-10">
      <ConfigDBBreadcrumbs/>
      <slot name="header"></slot>
    </div>
    <div class="flex-1 overflow-hidden">
      <div class="flex h-full">
        <div class="flex-1 overflow-auto" :class="[padding]">
          <slot></slot>
        </div>
        <slot name="sidebar"></slot>
      </div>
    </div>
  </div>
</template>

<script>
import ConfigDBBreadcrumbs from '@components/Nav/ConfigDBBreadcrumbs.vue'

export default {
  name: 'ConfigDBContainer',
  components: {
    ConfigDBBreadcrumbs,
  },

  props: {
    padding: { type: String, default: 'p-4' },
  },

  setup () {
    return {}
  },
}
</script>