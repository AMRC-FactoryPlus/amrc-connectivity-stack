<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-1.5">
      <i :class="`fa-fw fa-solid fa-${icon}`" style="font-size: 0.6rem"></i>
      <label class="flex items-center rounded-md text-xs font-medium">{{label}}</label>
    </div>
    <Copyable v-if="value" :text="value">
      <span class="flex items-center text-sm text-gray-700 hover:text-gray-950 bg-gray-50 h-6 hover:bg-gray-200 px-2 py-1 rounded-md text-nowrap truncate">{{value}}</span>
    </Copyable>
    <span v-else class="flex items-center text-sm text-gray-950 bg-gray-100 px-1.5 py-0.5 h-6 rounded-md opacity-60 hover:opacity-100 text-nowrap">-</span>
  </div>
</template>

<script>
import Copyable from '@components/Copyable.vue'

export default {
  name: 'SidebarDetail',
  components: {
    Copyable,
  },
  props: {
    icon: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    value: {
      type: String,
      required: true,
    },
  },
}
</script>