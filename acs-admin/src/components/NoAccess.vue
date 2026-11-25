<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- What a page shows instead of its data when the user's permissions
     don't let them read it. -->
<template>
  <EmptyState
      icon="lock"
      :title="`You don't have access to ${noun}.`"
      description="If you need it, ask a Factory+ administrator to give you access."
  >
    <template #actions>
      <slot name="actions"></slot>
    </template>
  </EmptyState>
</template>

<script>
import EmptyState from '@components/EmptyState.vue'

export default {
  name: 'NoAccess',

  components: {
    EmptyState,
  },

  props: {
    /* What the user can't read, as it follows "access to". */
    noun: {
      type: String,
      required: true,
    },
  },
}
</script>
