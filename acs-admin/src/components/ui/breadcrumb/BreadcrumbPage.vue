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
  <span
    role="link"
    aria-disabled="true"
    aria-current="page"
    :class="cn('font-normal text-slate-950 dark:text-slate-50', props.class)"
  >
    <slot />
  </span>
</template>
