<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col gap-2">
    <div v-if="paths.length" class="flex flex-col gap-1.5">
      <div class="grid grid-cols-[1fr_1fr_1.75rem] gap-2 text-[11px] text-gray-400">
        <span>Path on the host</span>
        <span>Path in the container</span>
        <span></span>
      </div>
      <div v-for="(path, index) in paths" :key="index" class="grid grid-cols-[1fr_1fr_1.75rem] gap-2 items-center">
        <!-- The shared Input is fixed at h-10 and cannot be restyled from
           - outside: its <script setup> defineProps overwrites the options
           - block's props, so class and className never reach the element.
           - These match its appearance at the height the design calls for. -->
        <input
            :class="inputClass"
            placeholder="/dev/ttyUSB0"
            :value="path.hostPath"
            @input="update(index, 'hostPath', $event.target.value)"
        />
        <input
            :class="inputClass"
            placeholder="/dev/ttyUSB0"
            :value="path.mountPath"
            @input="update(index, 'mountPath', $event.target.value)"
        />
        <Button
            variant="ghost"
            size="plain"
            class="h-8 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
            title="Remove path"
            @click="remove(index)"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </Button>
      </div>
    </div>
    <div v-else class="text-xs text-gray-400">
      No host paths. Nothing on the host machine is passed through to this driver.
    </div>
    <div>
      <Button
          variant="ghost"
          size="plain"
          class="h-7 px-2 gap-1.5 text-xs text-slate-700"
          @click="add"
      >
        <i class="fa-solid fa-plus text-[10px]"></i>
        Add host path
      </Button>
    </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button/index.js'

export default {
  name: 'HostPathsEditor',

  components: {
    Button,
  },

  props: {
    /* An array of `{ hostPath, mountPath }`, as stored under
     * `deployment.hostPaths` on a connection configuration. */
    modelValue: {
      type: Array,
      default: () => [],
    },
  },

  emits: ['update:modelValue'],

  data () {
    return {
      inputClass: 'flex h-8 w-full rounded-md border border-input bg-background '
        + 'px-2.5 py-1 text-[13px] font-mono ring-offset-background '
        + 'placeholder:text-muted-foreground focus-visible:outline-none '
        + 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
        + 'disabled:cursor-not-allowed disabled:opacity-50',
    }
  },

  computed: {
    paths () {
      return Array.isArray(this.modelValue) ? this.modelValue : []
    },
  },

  methods: {
    emit (paths) {
      this.$emit('update:modelValue', paths)
    },

    update (index, key, value) {
      const paths = this.paths.map((p, i) => i === index ? { ...p, [key]: value } : p)
      this.emit(paths)
    },

    add () {
      this.emit([...this.paths, { hostPath: '', mountPath: '' }])
    },

    remove (index) {
      this.emit(this.paths.filter((p, i) => i !== index))
    },
  },
}
</script>
