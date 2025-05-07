<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'
import { AlertDialogDescription } from 'reka-ui'
import { computed } from 'vue'

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
  <AlertDialogDescription
    v-bind="delegatedProps"
    :class="cn('text-sm text-slate-500 dark:text-slate-400', props.class)"
  >
    <slot />
  </AlertDialogDescription>
</template>
