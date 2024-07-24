<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="min-h-screen flex flex-col sm:justify-center items-center pt-6 sm:pt-0 bg-gray-100"
       :style="'background-image: url('+backgroundImagePath+')'">
    <LoginCard @login="logIn"/>
  </div>
</template>

<script>
import backgroundImagePath from '@/resources/assets/img/login-background.png'
import LoginCard from './LoginCard.vue'

export default {

  name: 'LoginPage',

  setup () {
    return { backgroundImagePath }
  },

  components: {
    LoginCard,
  },

  methods: {
    logIn (e) {
      if (this.loading) {
        return
      }
      let self = this
      self.loading = true
      axios.post('/login', {
        'email': e.username,
        'password': e.password,
      }).then(() => {
        window.location.href = '/'
      }).catch(error => {
        self.loading = false
        self.handleError(error)
      })
    },
  },

  data () {
    return {
      loading: false,
    }
  },
}
</script>

