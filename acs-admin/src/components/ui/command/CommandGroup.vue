<script setup>
import { computed } from "vue";
import { ComboboxGroup, ComboboxLabel } from "radix-vue";
import { cn } from "@/lib/utils";

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: null, required: false },
  heading: { type: String, required: false },
});

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <ComboboxGroup
    v-bind="delegatedProps"
    :class="
      cn(
        'overflow-hidden p-1 text-slate-950 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-500 dark:text-slate-50 dark:[&_[cmdk-group-heading]]:text-slate-400',
        props.class
      )
    "
  >
    <ComboboxLabel
      v-if="heading"
      class="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
    >
      {{ heading }}
    </ComboboxLabel>
    <slot />
  </ComboboxGroup>
</template>
