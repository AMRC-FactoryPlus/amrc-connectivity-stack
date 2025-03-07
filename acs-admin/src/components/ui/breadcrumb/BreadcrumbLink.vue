<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'
import { Primitive } from 'reka-ui'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false, default: 'a' },
  class: { type: null, required: false },
});
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn('transition-colors hover:text-slate-950 dark:hover:text-slate-50', props.class)"
  >
    <slot />
  </Primitive>
</template>
