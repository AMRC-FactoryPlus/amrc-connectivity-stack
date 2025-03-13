<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="dialogOpen" @update:open="e => dialogOpen = e">
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
      <div class="flex gap-6 overflow-auto flex-1 fix-inset">
        <Input
            title="Factory+ User UUID"
            class="max-w-sm"
            placeholder="e.g. 00000000-0000-0000-0000-000000000000"
            v-model="v$.user.$model"
            :v="v$.user"
        />

      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid" @click="formSubmit">
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
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import { usePrincipalStore } from '@store/usePrincipalStore.js'

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      p: usePrincipalStore()
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

  methods: {
    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      try {
        await this.s.client.Auth.fetch({
          method:     "PUT",
          url:        `v2/principal/${this.user}/kerberos`,
          body:       this.principal,
        })
        toast.success(`${this.principal} has been added`)
        this.dialogOpen = false
        this.s.client.Fetch.cache = "reload"
        await this.p.fetch()
        this.s.client.Fetch.cache = "default"
      } catch (err) {
        toast.error(`Unable to add ${this.principal}`)
        console.error(err)
      }
    }
  },

  data () {
    return {
      dialogOpen: false,
      principal: null,
      user: null
    }
  },

  validations: {
    principal: { required },
    user: { required },
  },
}
</script>