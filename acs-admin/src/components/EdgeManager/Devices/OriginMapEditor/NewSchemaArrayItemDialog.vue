<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="open" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Add New Item</DialogTitle>
        <DialogDescription>Create a new item for {{itemName}}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Item Name</label>
        <Input
            placeholder="e.g. Region1"
            v-model="v$.name.$model"
            :v="v$.name"
        />
        <div v-if="v$.$invalid && v$.$dirty" class="text-xs text-red-500">
          {{v$.$silentErrors[0]?.$message}}
        </div>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-plus"></i>
            <div>Create Item</div>
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
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'

export default {
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Input,
  },

  props: {
    open: {
      type: Boolean,
      required: true,
    },
    itemName: {
      type: String,
      required: true,
    },
    existingItems: {
      type: Array,
      default: () => [],
    },
  },

  setup() {
    return {
      v$: useVuelidate(),
    }
  },

  data() {
    return {
      name: null,
    }
  },

  validations: {
    name: {
      required,
      alphaNumUnderscoreSpace: helpers.withMessage('Letters, numbers, spaces and underscores are valid', (value) => {
        return /^[a-zA-Z0-9_ ]*$/.test(value)
      }),
      unique: helpers.withMessage('This name already exists', function(value) {
        if (!value) return true
        return !this.existingItems.includes(value)
      }),
    },
  },

  methods: {
    handleOpen(e) {
      this.$emit('update:open', e)
      if (e === false) {
        this.v$.name.$model = null
        this.v$.name.$reset()
      }
    },

    async formSubmit() {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      this.$emit('create', this.name)
      this.handleOpen(false)
    },
  },
}
</script>