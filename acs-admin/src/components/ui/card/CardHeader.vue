<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <div :class="cn('flex flex-col p-6', props.class)">
    <slot />
  </div>
</template>
