<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { Button } from '@/components/ui/button'
import { useSidebar } from './utils'

const props = defineProps({
  class: { type: null, required: false },
});

const { toggleSidebar } = useSidebar();
</script>

<template>
  <Button title="Toggle sidebar" data-sidebar="trigger" variant="ghost" size="icon" @click="toggleSidebar"><i class="fa-solid fa-sidebar"></i></Button>
</template>
