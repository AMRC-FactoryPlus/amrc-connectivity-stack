<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="dialogOpen" @update:open="handleOpen">
    <DialogTrigger>
      <Button>
        <div class="flex items-center justify-center gap-2">
          <i class="fa-solid fa-user-plus"></i>
          <div>Create User</div>
        </div>
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create a New User</DialogTitle>
        <DialogDescription>Create a Kerberos principal and a Factory+ user in one step</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Name</label>
        <Input
            placeholder="e.g. Jane Smith"
            v-model="v$.name.$model"
            :v="v$.name"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Kerberos Principal</label>
        <Input
            placeholder="e.g. jane.smith@MY-REALM.COM"
            v-model="v$.principal.$model"
            :v="v$.principal"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Password</label>
        <div class="flex gap-2">
          <Input
              class="flex-1"
              type="password"
              v-model="v$.password.$model"
              :v="v$.password"
          />
          <Button type="button" variant="outline" title="Generate a password" @click="generatePassword">
            <i class="fa-solid fa-dice"></i>
          </Button>
        </div>
        <Copyable v-if="password" :text="password" class="text-xs text-gray-500">
          Generated: <span class="font-mono">{{ password }}</span> (click to copy)
        </Copyable>
      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid || submitting" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i :class="submitting ? 'fa-solid fa-circle-notch animate-spin' : 'fa-solid fa-user-plus'"></i>
            <div>{{ submitting ? 'Creating...' : 'Create User' }}</div>
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
import Copyable from '@components/Copyable.vue'
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
      p: usePrincipalStore(),
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
    Copyable,
  },

  watch: {
    name (newName) {
      const suggested = this.derivePrincipal(newName)
      // Only overwrite the principal if it still matches our last
      // suggestion - once the user edits it by hand, leave it alone.
      if (this.principal === this.autoPrincipal) {
        this.principal = suggested
      }
      this.autoPrincipal = suggested
    },
  },

  methods: {
    handleOpen (e) {
      this.dialogOpen = e
      if (!e) this.close()
    },

    close () {
      this.v$.$reset()
      this.name = null
      this.principal = null
      this.password = null
      this.autoPrincipal = null
    },

    generatePassword () {
      // Excludes visually-ambiguous characters (0/O, 1/l/I) since this
      // may need to be read aloud or transcribed by hand to the new user.
      const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'
      const bytes = new Uint32Array(20)
      crypto.getRandomValues(bytes)
      this.password = Array.from(bytes, b => charset[b % charset.length]).join('')
    },

    // "Jane Smith" -> "jane.smith@REALM"
    derivePrincipal (name) {
      const parts = (name || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      if (!parts.length) return null

      const username = parts.join('.')
      const realm = this.s.baseUrl ? this.s.baseUrl.toUpperCase() : 'REALM.EXAMPLE.COM'
      return `${username}@${realm}`
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      this.submitting = true
      try {
        await this.s.client.UserAdmin.create_user({
          name: this.name,
          principal: this.principal,
          password: this.password,
        })
        toast.success(`${this.name} has been created`)
        this.dialogOpen = false
        this.close()
        this.s.client.Fetch.cache = "reload"
        await this.p.fetch()
        this.s.client.Fetch.cache = "default"
      } catch (err) {
        const description = err.status === 409
          ? `${this.principal} already exists`
          : err.message || 'An unexpected error occurred'
        toast.error(`Unable to create ${this.name}`, { description })
        console.error(err)
      } finally {
        this.submitting = false
      }
    }
  },

  data () {
    return {
      dialogOpen: false,
      submitting: false,
      name: null,
      principal: null,
      password: null,
      autoPrincipal: null,
    }
  },

  validations: {
    name: { required },
    principal: { required },
    password: { required },
  },
}
</script>
