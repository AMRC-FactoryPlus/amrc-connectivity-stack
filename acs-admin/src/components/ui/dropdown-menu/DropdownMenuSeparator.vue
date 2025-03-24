<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { computed } from 'vue'
import { DropdownMenuSeparator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: null, required: false },
});

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <DropdownMenuSeparator
    v-bind="delegatedProps"
    :class="cn('-mx-1 my-1 h-px bg-slate-100 dark:bg-slate-800', props.class)"
  />
</template>
