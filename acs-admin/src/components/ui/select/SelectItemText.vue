<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { SelectItemText } from 'reka-ui'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
</script>

<template>
  <SelectItemText v-bind="props">
    <slot />
  </SelectItemText>
</template>
