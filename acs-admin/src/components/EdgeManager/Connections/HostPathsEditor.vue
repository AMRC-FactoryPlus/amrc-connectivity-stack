<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col gap-2">
    <div v-if="paths.length" class="flex flex-col gap-2">
      <div class="flex items-center gap-2 text-xs font-medium text-gray-500">
        <div class="flex-1">Path on the host</div>
        <div class="flex-1">Path in the container</div>
        <div class="w-8"></div>
      </div>
      <div v-for="(path, index) in paths" :key="index" class="flex items-start gap-2">
        <Input
            placeholder="e.g. /dev/ttyUSB0"
            :model-value="path.hostPath"
            @update:model-value="update(index, 'hostPath', $event)"
        />
        <Input
            placeholder="e.g. /dev/ttyUSB0"
            :model-value="path.mountPath"
            @update:model-value="update(index, 'mountPath', $event)"
        />
        <Button
            class="w-8 shrink-0"
            variant="ghost"
            size="icon"
            title="Remove this host path"
            @click="remove(index)"
        >
          <i class="fa-solid fa-trash text-red-400"></i>
        </Button>
      </div>
    </div>
    <div v-else class="text-sm text-gray-400">
      No host paths. This connection does not use any hardware attached to the host.
    </div>
    <div>
      <Button variant="outline" size="sm" class="gap-1.5" @click="add">
        <i class="fa-solid fa-plus"></i>
        Add Host Path
      </Button>
    </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button/index.js'
import { Input } from '@components/ui/input/index.js'

export default {
  name: 'HostPathsEditor',

  components: {
    Button,
    Input,
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
