<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - A node the composer does not model.
  -
  - This reads as preserved rather than broken, because that is what it
  - is. The user has done nothing wrong, and the schema is not damaged:
  - the node round-trips exactly as written.
  -->

<template>
  <div class="flex max-w-2xl flex-col gap-3.5">
    <div class="text-sm leading-relaxed text-gray-700">
      This node uses a construct the editor does not model. It is kept
      exactly as written and published unchanged.
    </div>

    <div class="overflow-hidden rounded-md border border-slate-200 bg-gray-50">
      <div class="flex items-center justify-between border-b border-slate-200 px-2.5 py-1.5">
        <span class="font-mono text-xs text-gray-500">{{ node.key }}</span>
        <span class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5
                     text-xs text-gray-900">
          <i class="fa-solid fa-lock text-[8px]"></i>Read-only
        </span>
      </div>
      <pre class="m-0 overflow-auto p-2.5 font-mono text-[11.5px] leading-relaxed
                  text-slate-600">{{ body }}</pre>
    </div>

    <div class="text-xs text-gray-500">
      Edit it in the raw JSON view, or leave it alone.
    </div>
  </div>
</template>

<script>
export default {
  name: 'OpaquePanel',

  props: {
    node: { type: Object, required: true },
  },

  computed: {
    body () {
      return JSON.stringify(this.node.raw, null, 2)
    },
  },
}
</script>
