<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="h-svh flex items-center justify-center">
    <LoginDialog/>
  </div>
</template>

<script>


import { defineComponent } from 'vue'
import LoginDialog from '@components/LoginDialog.vue'

export default defineComponent({
  name: 'Login',
  components: {LoginDialog}
})

</script>