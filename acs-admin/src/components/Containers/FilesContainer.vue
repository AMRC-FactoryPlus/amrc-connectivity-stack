<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col h-[calc(100vh-100px)] ">
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

export default {
  name: 'FilesContainer',
  components: {

    props: {
      padding: {type: String, default: 'p-4'},
    },

    setup() {
      return {}
    }
  }
}
</script>