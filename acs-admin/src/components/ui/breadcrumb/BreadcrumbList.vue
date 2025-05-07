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
  <ol
    :class="
      cn(
        'flex flex-wrap items-center gap-1 break-words text-sm text-slate-500 dark:text-slate-400',
        props.class,
      )
    "
  >
    <slot />
  </ol>
</template>
