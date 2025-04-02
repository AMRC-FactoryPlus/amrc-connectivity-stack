<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <nav aria-label="breadcrumb" :class="props.class">
    <slot />
  </nav>
</template>
