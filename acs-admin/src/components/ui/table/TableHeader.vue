<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <thead :class="cn('[&_tr]:border-b dark:border-slate-800', props.class)">
    <slot />
  </thead>
</template>
