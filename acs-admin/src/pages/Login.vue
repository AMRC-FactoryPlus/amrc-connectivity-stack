<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="h-svh flex items-center justify-center">
    <LoginDialog v-if="!oidcConfigured"/>
  </div>
</template>

<script>


import { defineComponent } from 'vue'
import LoginDialog from '@components/LoginDialog.vue'
import { useServiceClientStore } from '@/store/serviceClientStore.js'

export default defineComponent({
  name: 'Login',
  components: {LoginDialog},

  data () {
    return {
      // When OIDC is configured there's no form to show: the user is sent
      // straight to Keycloak (or their session is resumed silently). This
      // page is only reachable directly because `/login` is `anonAllowed`
      // and so skips the router auth guard in main.js.
      oidcConfigured: !!import.meta.env.OIDC_DISCOVERY_URL,
    }
  },

  async mounted () {
    if (!this.oidcConfigured) return
    try {
      await useServiceClientStore().login()
      this.$router.push("/")
    } catch (e) {
      console.error("OIDC login failed", e)
    }
  },
})

</script>