<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { SelectValue } from 'reka-ui'

const props = defineProps({
  placeholder: { type: String, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
</script>

<template>
  <SelectValue v-bind="props">
    <slot />
  </SelectValue>
</template>
