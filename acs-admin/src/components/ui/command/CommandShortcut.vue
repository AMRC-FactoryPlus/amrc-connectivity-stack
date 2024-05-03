<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <span
    :class="
      cn(
        'ml-auto text-xs tracking-widest text-slate-500 dark:text-slate-400',
        props.class
      )
    "
  >
    <slot />
  </span>
</template>
