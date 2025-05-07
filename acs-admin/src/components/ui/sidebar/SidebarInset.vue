<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <main
    :class="
      cn(
        'relative flex overflow-hidden flex-1 flex-col bg-white dark:bg-slate-950',
        'peer-data-[variant=inset]:h-full md:peer-data-[variant=inset]:m-2 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow',
        props.class,
      )
    "
  >
    <slot />
  </main>
</template>
