<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { ComboboxRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps({
  open: { type: Boolean, required: false },
  defaultOpen: { type: Boolean, required: false },
  resetSearchTermOnBlur: { type: Boolean, required: false },
  resetSearchTermOnSelect: { type: Boolean, required: false },
  ignoreFilter: { type: Boolean, required: false },
  modelValue: { type: null, required: false },
  defaultValue: { type: null, required: false },
  multiple: { type: Boolean, required: false },
  dir: { type: String, required: false },
  disabled: { type: Boolean, required: false },
  highlightOnHover: { type: Boolean, required: false },
  by: { type: [String, Function], required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  name: { type: String, required: false },
  required: { type: Boolean, required: false },
});
const emits = defineEmits(['update:modelValue', 'highlight', 'update:open']);

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <ComboboxRoot v-bind="forwarded">
    <slot />
  </ComboboxRoot>
</template>
