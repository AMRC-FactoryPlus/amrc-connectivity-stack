<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { computed } from 'vue'
import { DialogDescription } from 'reka-ui'
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
  <DialogDescription
    :class="cn('text-sm text-slate-500 dark:text-slate-400', props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </DialogDescription>
</template>
