<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <div
    :class="
      cn('animate-pulse rounded-md bg-slate-100 dark:bg-slate-800', props.class)
    "
  />
</template>
