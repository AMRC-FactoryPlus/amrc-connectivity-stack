<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- What the timeline's block styles, data strips and status dots mean. -->
<template>
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2.5 rounded-sm border border-slate-300 bg-slate-100"></span>Run
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2.5 rounded-sm border border-green-600 bg-green-50"></span>Recording now
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2.5 rounded-sm border border-dashed border-slate-500"></span>Reference window
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2.5 rounded-sm border border-dashed border-slate-300"></span>Voided
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2.5 rounded-sm border border-slate-200"
            style="background: repeating-linear-gradient(135deg, #f8fafc 0 3px, #e2e8f0 3px 5px)"></span>Ongoing, no time window
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="inline-flex gap-px"><span class="h-2.5 w-[9px]" style="background: rgba(15,23,42,0.45)"></span><span class="h-2.5 w-[9px]" style="background: rgba(15,23,42,0.85)"></span></span>Data arrived (darker is more)
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2 rounded-full bg-green-500"></span>Live
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2 rounded-full bg-amber-500"></span>Quiet: online, no recent data
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="size-2 rounded-full bg-slate-400"></span>Offline
    </span>
    <span>
      <i class="fa-solid fa-hand-pointer mr-1"></i>Drag across device lanes to select devices and a window. Click a block to open it. Scroll sideways (or hold Shift and scroll) to move through time.
    </span>
  </div>
</template>
