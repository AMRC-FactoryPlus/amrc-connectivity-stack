<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="w-full sm:max-w-md mt-6 shadow-md overflow-hidden bg-[#FAFAFA]">
    <div class="bg-[#434953] p-10 flex items-center justify-center gap-3">
      <img class="h-12" src="@/resources/assets/img/uos-logo.png" alt="">
      <img class="h-12" src="@/resources/assets/img/amrc-logo.png" alt="">
    </div>
    <div class="px-6 py-4">
      <div class="text-gray-600 text-2xl mt-4 font-bold">
        Factory+
      </div>
      <div class="text-gray-400 text-lg mb-3">
        ACS Manager
      </div>

      <TextField class="mb-2" placeholder="Username" icon="user" v-model="v$.form.username.$model"
                 :valid="v$.form.username"/>
      <TextField class="mb-5" @keyUpEnter="login" placeholder="Password" icon="lock" type="password"
                 v-model="v$.form.password.$model" :valid="v$.form.password"/>

      <Button
          class="mb-6"
          type="primary"
          :loading="loading"
          :disabled="!v$.$anyDirty || v$.$invalid"
          icon-position="right"
          icon="arrow-right"
          text="Log In"
          @mouseup="login"/>
    </div>
  </div>
</template>
<script>
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import TextField from '@/resources/js/components/TextField.vue'
import Button from '@/resources/js/components/Button.vue'

export default {
  name: 'LoginCard',

  setup () {
    return { v$: useVuelidate({ $stopPropagation: true }) }
  },

  components: {
    TextField,
    Button,
  },

  props: {
    loading: {
      type: Boolean,
      default: false,
    },
  },

  methods: {
    login () {
      this.$emit('login',
          {
            username: this.form.username,
            password: this.form.password,
          },
      )
    },
  },

  data () {
    return {
      form: {
        username: null,
        password: null,
      },
    }
  },

  validations () {
    return {
      form: {
        username: {
          required: helpers.withMessage('Username is required', required),
        },
        password: {
          required: helpers.withMessage('Password is required', required),
        },
      },
    }
  },
}
</script>
