<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col h-[calc(100vh-100px)] -m-4">
    <div class="flex-1 overflow-hidden">
      <div class="flex h-full">
        <div class="flex-1 overflow-auto p-6">
          <slot></slot>
        </div>
        <slot name="sidebar"></slot>
      </div>
    </div>
  </div>
</template>

<script>

export default {
  name: 'BridgesContainer',
  components: {
    setup() {
      return {}
    }
  }
}
</script>
