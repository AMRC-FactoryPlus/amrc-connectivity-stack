<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The frame of a Gateway Depot page: the content, with a side panel
     beside it on a laptop and under it on a narrow screen, where the
     page scrolls as one. -->
<template>
  <div class="flex flex-col lg:h-[calc(100vh-100px)] lg:-m-4">
    <div class="flex-1 lg:overflow-hidden">
      <div class="flex flex-col lg:flex-row lg:h-full">
        <div class="flex-1 min-w-0 p-4 lg:p-6 lg:overflow-auto">
          <slot></slot>
        </div>
        <slot name="sidebar"></slot>
      </div>
    </div>
  </div>
</template>

<script>

export default {
  name: 'GatewayDepotContainer',
}
</script>
