<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A short line drawn in a run's chart style, as its legend. -->
<template>
  <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true" class="shrink-0">
    <line x1="1" y1="4" x2="27" y2="4" :stroke="lineStyle.color" stroke-width="2"
          :stroke-dasharray="lineStyle.dash ?? undefined" :stroke-opacity="lineStyle.opacity"/>
  </svg>
</template>

<script setup>
defineProps({ lineStyle: { type: Object, required: true } })
</script>
