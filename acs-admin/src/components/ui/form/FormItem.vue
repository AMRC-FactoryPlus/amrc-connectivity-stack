<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'
import { useId } from 'reka-ui'
import { provide } from 'vue'
import { FORM_ITEM_INJECTION_KEY } from './injectionKeys'

const props = defineProps({
  class: { type: null, required: false },
});

const id = useId();
provide(FORM_ITEM_INJECTION_KEY, id);
</script>

<template>
  <div :class="cn('space-y-2', props.class)">
    <slot />
  </div>
</template>
