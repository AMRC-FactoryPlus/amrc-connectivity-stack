<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="h-svh flex items-center justify-center">
    <LoginDialog v-if="!oidcConfigured"/>
    <Card v-else-if="oidcError" class="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle class="text-2xl">Unable to sign in</CardTitle>
        <CardDescription>
          Something went wrong talking to the login server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button class="w-full" @click="tryOidcLogin">Try again</Button>
      </CardContent>
    </Card>
  </div>
</template>

<script>


import { defineComponent } from 'vue'
import LoginDialog from '@components/LoginDialog.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { toast } from 'vue-sonner'

export default defineComponent({
  name: 'Login',
  components: {LoginDialog, Button, Card, CardContent, CardDescription, CardHeader, CardTitle},

  data () {
    return {
      // When OIDC is configured there's no form to show: the user is sent
      // straight to Keycloak (or their session is resumed silently). This
      // page is only reachable directly because `/login` is `anonAllowed`
      // and so skips the router auth guard in main.js.
      oidcConfigured: useServiceClientStore().oidcConfigured,
      oidcError: false,
    }
  },

  async mounted () {
    if (this.oidcConfigured) await this.tryOidcLogin()
  },

  methods: {
    async tryOidcLogin () {
      this.oidcError = false
      try {
        await useServiceClientStore().login()
        this.$router.push("/")
      } catch (e) {
        console.error("OIDC login failed", e)
        toast.error("Login failed")
        this.oidcError = true
      }
    },
  },
})

</script>