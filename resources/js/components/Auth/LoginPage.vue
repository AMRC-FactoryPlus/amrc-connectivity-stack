<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="min-h-screen flex flex-col sm:justify-center items-center pt-6 sm:pt-0 bg-gray-100"
       :style="'background-image: url('+backgroundImagePath+')'">
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

        <TextField class="mb-2" placeholder="Username" icon="user" v-model="v$.form.username.$model" :valid="v$.form.username"/>
        <TextField class="mb-5" @keyUpEnter="logIn" placeholder="Password" icon="lock" type="password" v-model="v$.form.password.$model" :valid="v$.form.password"/>

        <Button
            class="mb-6"
            type="primary"
            :loading="loading"
            :disabled="!v$.$anyDirty || v$.$invalid"
            icon-position="right"
            icon="arrow-right"
            text="Log In"
            @mouseup="logIn"/>
      </div>
      </div>
  </div>
</template>

<script>
import backgroundImagePath from '@/resources/assets/img/login-background.png'
import useVuelidate from '@vuelidate/core';
import { helpers, required } from '@vuelidate/validators';

export default {
  setup () {
    return { v$: useVuelidate({ $stopPropagation: true }) };
  },

  name: 'LoginPage',

  components: {
    'TextField': () => import(/* webpackPrefetch: true */ '../TextField.vue'),
    'Button': () => import(/* webpackPrefetch: true */ '../Button.vue'),
  },

  methods: {
    logIn() {
      if (this.loading) {
        return;
      }
      let self = this;
      self.loading = true;
      axios.post('/login', {
        'email': this.form.username,
        'password': this.form.password,
      }).then(() => {
        window.location.href = '/';
      }).catch(error => {
        self.loading = false;
        self.handleError(error);
      });
    },
  },

  data () {
    return {
      backgroundImagePath: backgroundImagePath,
      loading: false,
      form: {
        username: null,
        password: null,
      },
    };
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
    };
  },
};
</script>

