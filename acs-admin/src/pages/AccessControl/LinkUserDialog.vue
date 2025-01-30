<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog>
    <DialogTrigger>
      <Button>
        <div class="flex items-center justify-center gap-2">
          <i class="fa-solid fa-user-plus"></i>
          <div>Link User</div>
        </div>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Link a New User</DialogTitle>
        <DialogDescription>Bind a Factory+ user to a Kerberos Principal</DialogDescription>
      </DialogHeader>
      <div class="flex justify-center gap-6 overflow-auto flex-1 fix-inset">
        <Input
            title="Kerberos Principal"
            class="max-w-sm"
            placeholder="e.g. admin@MY-REALM.COM"
            v-model="v$.principal.$model"
            :v="v$.principal"
        />

      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-user-plus"></i>
            <div>Link User</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { VisuallyHidden } from 'radix-vue'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { required } from '@vuelidate/validators'

export default {

  setup () {
    return {
      v$: useVuelidate()
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
    DialogTrigger,
    VisuallyHidden,
    Input,
  },

  data () {
    return {
      principal: null,
    }
  },

  validations: {
    principal: { required },
  },
}
</script>