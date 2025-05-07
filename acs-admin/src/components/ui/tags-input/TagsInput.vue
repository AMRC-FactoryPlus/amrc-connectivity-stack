<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'
import { TagsInputRoot, useForwardPropsEmits } from 'reka-ui'
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [Array, null], required: false },
  defaultValue: { type: Array, required: false },
  addOnPaste: { type: Boolean, required: false },
  addOnTab: { type: Boolean, required: false },
  addOnBlur: { type: Boolean, required: false },
  duplicate: { type: Boolean, required: false },
  disabled: { type: Boolean, required: false },
  delimiter: { type: null, required: false },
  dir: { type: String, required: false },
  max: { type: Number, required: false },
  id: { type: String, required: false },
  convertValue: { type: Function, required: false },
  displayValue: { type: Function, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  name: { type: String, required: false },
  required: { type: Boolean, required: false },
  class: { type: null, required: false },
});
const emits = defineEmits([
  'update:modelValue',
  'invalid',
  'addTag',
  'removeTag',
]);

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <TagsInputRoot
    v-bind="forwarded"
    :class="
      cn(
        'flex flex-wrap gap-2 items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950',
        props.class,
      )
    "
  >
    <slot />
  </TagsInputRoot>
</template>
