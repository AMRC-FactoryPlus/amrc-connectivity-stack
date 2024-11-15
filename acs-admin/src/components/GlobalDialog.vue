<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{title}}</AlertDialogTitle>
        <AlertDialogDescription>
          {{message}}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="cancel">{{cancelText}}</AlertDialogCancel>
        <AlertDialogAction @click="confirm">{{confirmText}}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
</template>

<script>
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'

export default {

  components: {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  },

  props: {
    title: {
      type: String,
      default: '',
    },
    message: {
      type: String,
      default: '',
    },
    confirmText: {
      type: String,
      default: 'Confirm',
    },
    cancelText: {
      type: String,
      default: 'Cancel',
    },
    onConfirm: {
      type: Function,
      default: null,
    },
    onCancel: {
      type: Function,
      default: null,
    },
  },
  data () {
    return {
      open: true,
    }
  },
  methods: {
    confirm () {
      if (this.onConfirm) this.onConfirm()
      this.close()
    },
    cancel () {
      if (this.onCancel) this.onCancel()
      this.close()
    },
    close () {
      this.open = false
      this.$emit('close')
    },
  },
}
</script>