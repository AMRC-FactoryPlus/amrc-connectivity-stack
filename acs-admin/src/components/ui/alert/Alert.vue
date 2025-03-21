<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<script setup>
import { cn } from '@/lib/utils'
import { alertVariants } from '.'

const props = defineProps({
  class: { type: null, required: false },
  variant: { type: null, required: false },
});
</script>

<template>
  <div :class="cn(alertVariants({ variant }), props.class)" role="alert">
    <slot />
  </div>
</template>
