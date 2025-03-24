<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { DropdownMenuGroup } from 'reka-ui'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
});
</script>

<template>
  <DropdownMenuGroup v-bind="props">
    <slot />
  </DropdownMenuGroup>
</template>
