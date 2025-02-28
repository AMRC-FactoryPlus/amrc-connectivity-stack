<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { CollapsibleTrigger } from 'radix-vue'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
</script>

<template>
  <CollapsibleTrigger v-bind="props">
    <slot />
  </CollapsibleTrigger>
</template>
