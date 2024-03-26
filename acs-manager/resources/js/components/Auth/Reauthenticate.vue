<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->
<script setup>

import LoginCard from '@/resources/js/components/Auth/LoginCard.vue'
</script>

<template>
  <div v-if="showing" class="fixed inset-0 bg-gray-700/40 z-[1000] backdrop-blur-sm flex items-center justify-center">
    <LoginCard @login="login" :loading="loading"></LoginCard>
  </div>
</template>

<script>
export default {

  mounted () {
    window.events.$on('show-reauthenticate-modal', (originalRequest) => {
      if (this.showing) {
        // If we're already showing we need to store the new request
        // in the queue to fire off once we've re-authenticated
        this.originalRequests.push(originalRequest)

        return;
      }

      this.showing = true
      this.originalRequests = [originalRequest]
    })
  },

  methods: {
    login (e) {
      if (this.loading) {
        return
      }
      this.loading = true
      axios.post('/api/reauthenticate', {
        'username': e.username,
        'password': e.password,
      }).then(() => {
        this.originalRequests.forEach((originalRequest) => {
          originalRequest();
        })
        this.loading = false
        this.originalRequests = []
        this.showing = false
      }).catch(error => {
        this.loading = false
        this.handleError(error)
      })
    },
  },

  data () {
    return {
      showing: false,
      originalRequests: [],
      loading: false,
    }
  },
}
</script>
