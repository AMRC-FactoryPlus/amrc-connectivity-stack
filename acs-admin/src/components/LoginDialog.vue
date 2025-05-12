<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Card class="mx-auto max-w-sm transition-all duration-300 hover:ring ring-offset-2 ring-offset-gray-100 ring-gray-400 !ring-opacity-30">
    <CardHeader>
      <CardTitle class="text-2xl">
        Welcome to ACS!
      </CardTitle>
      <CardDescription>
        Enter your details below to login to your account
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="grid gap-4">
        <div class="grid gap-2">
          <Label for="username">Username</Label>
          <Input
              autofocus
              id="username"
              type="text"
              placeholder="e.g. me1ago"
              required
              v-model="username"
              @keydown.enter="login"
          />
        </div>
        <div class="grid gap-2">
          <div class="flex items-center">
            <Label for="password">Password</Label>
          </div>
          <Input @keydown.enter="login" v-model="password" id="password" type="password" required/>
        </div>
        <Button :disabled="buttonDisabled" @click="login" type="submit" class="w-full">
          <div v-if="!loggingIn">Login</div>
          <div v-else class="flex items-center justify-center">
            <i class="fa-solid fa-circle-notch animate-spin"></i>
          </div>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script>
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {toast} from "vue-sonner";

export default {

  name: 'LoginDialog',

  components: {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Input,
    Label,
  },

  setup () {
    return {
      s: useServiceClientStore(),
    }
  },

  computed: {
    buttonDisabled () {
      return !this.username || !this.password || this.loggingIn
    },

    directory () {
      return import.meta.env.SCHEME + '://directory.' + import.meta.env.BASEURL
    },
  },

  methods: {
    async login () {
      this.loggingIn = true
      try{
        await this.s.login({
        directory_url: this.directory,
        username: this.username,
        password: this.password,
        browser: true,
        verbose: import.meta.env.VERBOSE ?? "",
      })
        this.$router.push("/");
      }catch(e){
        toast.error(`Login Failed`)
      }

      this.loggingIn = false
    },
  },

  data () {
    return {
      loggingIn: false,
      username: null,
      password: null,
    }
  },
}
</script>
