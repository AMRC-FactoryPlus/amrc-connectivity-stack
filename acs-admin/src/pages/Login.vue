
<template>
  <div class="flex flex-1 items-center justify-center">
    <LoginDialog/>
  </div>

</template>

<script>


import {defineComponent} from "vue";
import LoginDialog from "@components/LoginDialog.vue";

export default defineComponent({
  name: 'Login',
  components: {LoginDialog}
})

</script>