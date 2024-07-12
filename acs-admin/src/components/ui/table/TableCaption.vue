<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <caption
    :class="cn('mt-4 text-sm text-slate-500 dark:text-slate-400', props.class)"
  >
    <slot />
  </caption>
</template>
