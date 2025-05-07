<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <Input
    data-sidebar="input"
    :class="
      cn(
        'h-8 w-full bg-white shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring dark:bg-slate-950',
        props.class,
      )
    "
  >
    <slot />
  </Input>
</template>
