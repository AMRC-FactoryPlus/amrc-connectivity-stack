<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col h-[calc(100vh-64px)] ">
    <div class="flex justify-end bg-white sticky border-b pb-4 z-10">
      <slot name="header"></slot>
    </div>
    <div class="flex-1 pt-2 overflow-hidden">
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