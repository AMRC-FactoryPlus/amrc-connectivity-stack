<template>
  <Card class="mx-auto max-w-sm">
    <CardHeader>
      <CardTitle class="text-2xl">
        Welcome to ACS
      </CardTitle>
      <CardDescription>
        Enter your details below to login to your account
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="grid gap-4">
        <div class="grid gap-2">
          <Label for="email">Username</Label>
          <Input
              autofocus
              id="username"
              type="text"
              placeholder="e.g. me1ago"
              required
              v-model="username"
          />
        </div>
        <div class="grid gap-2">
          <div class="flex items-center">
            <Label for="password">Password</Label>
          </div>
          <Input @keydown.enter="login" v-model="password" id="password" type="password" required/>
        </div>
        <Button :disabled="!username || !password" @click="login" type="submit" class="w-full">
          Login
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

export default {

  name: 'Login',

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
    directory () {
      return import.meta.env.VITE_SCHEME + '://directory.' + import.meta.env.VITE_BASE_URL
    },
  },

  methods: {
    login () {
      this.s.login({
        directory_url: this.directory,
        username: this.username,
        password: this.password,
        browser: true,
      })
    },
  },

  data () {
    return {
      username: null,
      password: null,
    }
  },
}
</script>
