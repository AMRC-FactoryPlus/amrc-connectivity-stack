<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[600px] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? 'Edit Node' : 'Create a New Node' }}</DialogTitle>
        <DialogDescription>{{ isEditMode ? 'Update this ISA-95 hierarchy node' : 'Add a node to the ISA-95 hierarchy vocabulary' }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-4 flex-1 fix-inset">
        <!-- Level -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Level <span class="text-red-500">*</span></label>
          <Select v-model="level" :disabled="isEditMode">
            <SelectTrigger>
              <SelectValue>
                {{ level ?? 'Select a level...' }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="l in ISA95_LEVELS" :value="l" :key="l">
                  {{ l }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <!-- Name -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Name <span class="text-red-500">*</span></label>
          <Input
            :placeholder="level ? `e.g. ${namePlaceholder}` : 'Select a level first'"
            v-model="v$.name.$model"
            :v="v$.name"
          />
        </div>

        <!-- Parent -->
        <div v-if="level && level !== 'Enterprise'" class="flex flex-col gap-2">
          <label class="text-sm font-medium">Parent {{ parentLevel }} <span class="text-red-500">*</span></label>
          <Select v-model="parentUuid">
            <SelectTrigger :class="{'border-red-500': v$.parentUuid.$error}">
              <SelectValue>
                {{ parentOptions.find(p => p.uuid === parentUuid)?.name ?? `Select ${parentLevel ? 'a ' + parentLevel : 'a parent'}...` }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="p in parentOptions" :value="p.uuid" :key="p.uuid">
                  {{ p.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="parentOptions.length === 0" class="text-xs text-gray-500">
            No {{ parentLevel }} nodes exist yet. Create one first.
          </p>
        </div>

        <!-- Aliases -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Aliases</label>
          <p class="text-sm text-gray-500">
            Alternative names that resolve to this node when searching
          </p>
          <div class="flex flex-col gap-2 mt-2">
            <div v-for="(alias, index) in aliases" :key="index" class="flex gap-2">
              <Input
                v-model="aliases[index]"
                placeholder="e.g. F2050"
                class="flex-1"
              />
              <Button variant="ghost" size="icon" @click="removeAlias(index)">
                <i class="fa-solid fa-trash text-gray-400"></i>
              </Button>
            </div>
            <Button variant="outline" @click="addAlias" class="w-full">
              <i class="fa-solid fa-plus mr-2"></i>
              Add Alias
            </Button>
          </div>
        </div>
      </div>

      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid || isSubmitting" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i :class="{'fa-solid': true, 'fa-plus': !isEditMode && !isSubmitting, 'fa-save': isEditMode && !isSubmitting, 'fa-circle-notch animate-spin': isSubmitting}"></i>
            <div>{{ isSubmitting ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Create Node') }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { ISA95_LEVELS, ISA95_LEVEL_CLASSES, useISA95Store } from '@store/useISA95Store.js'
import useVuelidate from '@vuelidate/core'
import { helpers, required, requiredIf } from '@vuelidate/validators'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

const NAME_PLACEHOLDERS = {
    'Enterprise':  'AMRC',
    'Site':        'Factory 2050',
    'Area':        'Machining',
    'Work Center': 'Cell 3',
    'Work Unit':   'Robot 1',
}

export default {
  setup() {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      isa95: useISA95Store(),
      ISA95_LEVELS,
    }
  },

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
  },

  async mounted() {
    window.events.on('show-new-isa95-node-dialog', (node) => {
      this.reset()
      if (node) {
        this.loadNode(node)
      }
      this.isa95.start()
      this.isOpen = true
    })
  },

  data() {
    return {
      isOpen: false,
      isSubmitting: false,
      editUuid: null,
      originalParentUuid: null,
      level: null,
      name: '',
      parentUuid: null,
      aliases: [],
    }
  },

  validations() {
    return {
      level: {
        required: helpers.withMessage('Select a level', required),
      },
      name: {
        required: helpers.withMessage('Enter a name for the node', required),
      },
      parentUuid: {
        required: helpers.withMessage(
          'Select a parent node',
          requiredIf(() => this.level && this.level !== 'Enterprise')),
      },
    }
  },

  computed: {
    isEditMode() {
      return this.editUuid !== null
    },
    parentLevel() {
      const index = ISA95_LEVELS.indexOf(this.level)
      return index > 0 ? ISA95_LEVELS[index - 1] : null
    },
    parentOptions() {
      if (!this.parentLevel) return []
      return this.isa95.data.filter(n => n.level === this.parentLevel)
    },
    namePlaceholder() {
      return NAME_PLACEHOLDERS[this.level] ?? ''
    },
  },

  watch: {
    level() {
      /* A node at the old level's parent makes no sense at the new one. */
      if (!this.isEditMode) this.parentUuid = null
    },
  },

  methods: {
    handleOpen(open) {
      this.isOpen = open
      if (!open) this.reset()
    },

    reset() {
      this.editUuid = null
      this.originalParentUuid = null
      this.level = null
      this.name = ''
      this.parentUuid = null
      this.aliases = []
      this.v$.$reset()
    },

    loadNode(node) {
      this.editUuid = node.uuid
      this.level = node.level
      this.name = node.name
      this.aliases = [...node.aliases]
      const parents = this.isa95.parents_of(node.uuid)
      this.parentUuid = parents[0]?.uuid ?? null
      this.originalParentUuid = this.parentUuid
    },

    addAlias() {
      this.aliases.push('')
    },

    removeAlias(index) {
      this.aliases.splice(index, 1)
    },

    async link(parentUuid, childUuid) {
      const parent = this.isa95.by_uuid(parentUuid)
      if (!parent || parent.children.includes(childUuid)) return
      await this.s.client.ConfigDB.put_config(UUIDs.App.ISA95Vocabulary, parentUuid, {
        aliases: parent.aliases,
        children: [...parent.children, childUuid],
      })
    },

    async unlink(parentUuid, childUuid) {
      const parent = this.isa95.by_uuid(parentUuid)
      if (!parent) return
      await this.s.client.ConfigDB.put_config(UUIDs.App.ISA95Vocabulary, parentUuid, {
        aliases: parent.aliases,
        children: parent.children.filter(c => c !== childUuid),
      })
    },

    async formSubmit() {
      this.isSubmitting = true
      try {
        const cdb = this.s.client.ConfigDB
        const aliases = this.aliases.map(a => a.trim()).filter(a => a !== '')

        let uuid = this.editUuid
        if (!this.isEditMode) {
          uuid = await cdb.create_object(ISA95_LEVEL_CLASSES[this.level])
        }

        await cdb.put_config(UUIDs.App.Info, uuid, { name: this.name.trim() })
        await cdb.put_config(UUIDs.App.ISA95Vocabulary, uuid, {
          aliases,
          children: this.isa95.by_uuid(uuid)?.children ?? [],
        })

        if (this.parentUuid !== this.originalParentUuid) {
          if (this.originalParentUuid) await this.unlink(this.originalParentUuid, uuid)
          if (this.parentUuid) await this.link(this.parentUuid, uuid)
        }

        toast.success(this.isEditMode ? 'Node updated successfully' : 'Node created successfully')
        this.isOpen = false
        this.reset()
      } catch (err) {
        console.error('Failed to save node:', err)
        toast.error('Failed to save node', {
          description: err.message || 'An unexpected error occurred'
        })
      } finally {
        this.isSubmitting = false
      }
    },
  },
}
</script>
