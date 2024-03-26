<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template></template>

<script>
import Alert from './Alert.vue';
import { v4 as uuidv4 } from 'uuid';

export default {

  props: {
    /**
     * A set of properties to allow the session to populate a notification via Blade. Usually used for pre-platform auth
     */
    type: { required: false, type: String },
    title: { required: false, type: String },
    description: { required: false, type: String },
  },

  created () {
    // Listen for notifications on the client event bus
    window.events.$on('showNotification', (payload) => {
      this.showNotification(payload);
    });

    window.events.$on('showResponseSuccess', (payload) => {
      this.showResponseSuccess(payload);
    });

    window.events.$on('showResponseFailed', (payload) => {
      this.showResponseFailed(payload);
    });

    window.events.$on('showResponseError', (e) => {
      this.showResponseError(e);
    });

    window.events.$on('hideNotification', (payload) => {
      this.hideNotification(payload);
    });
  },

  mounted () {

    // If data has been passed in via props then display it
    if (this.title && this.description) {
      this.showNotification({
        type: this.type,
        title: this.title,
        description: this.description
      })
    }
  },

  components: {},

  methods: {

    showNotification (payload) {
      let uuid = null;
      if (!payload.id) {
        uuid = uuidv4();
      } else {
        uuid = payload.id;
      }

      let content = {
        component: Alert,
        props: {
          id: uuid,
          type: payload.type,
          title: payload.title,
          description: payload.description,
          buttons: payload.buttons,
        },
        listeners: {
          close: (id) => {
            this.$toast.dismiss(id);
          },
        },
      };
      let options = {
        id: uuid,
        position: 'bottom-left',
        timeout: payload.persistent ? 0 : 5000,
        closeOnClick: false,
        pauseOnFocusLoss: true,
        pauseOnHover: true,
        draggable: true,
        draggablePercent: 0.4,
        showCloseButtonOnHover: false,
        hideProgressBar: false,
        closeButton: false,
        rtl: false,
      };

      switch (payload.type) {
        case 'success':
          this.$toast.success(content, options);
          break;
        case 'info':
          this.$toast.info(content, options);
          break;
        case 'error':
          this.$toast.error(content, options);
          break;
        case 'warning':
          this.$toast.warning(content, options);
          break;
        default:
          this.$toast(content, options);
          break;

      }

    },

    showResponseSuccess (payload) {
      let uuid = null;
      if (!payload.id) {
        uuid = uuidv4();
      } else {
        uuid = payload.id;
      }

      let content = {
        component: Alert,
        props: {
          id: uuid,
          type: 'success',
          title: 'Success',
          description: payload.description,
        },
        listeners: {
          close: (id) => {
            this.$toast.dismiss(id);
          },
        },
      };
      let options = {
        id: uuid,
        position: 'bottom-left',
        timeout: payload.persistent ? 0 : 2000,
        closeOnClick: true,
        draggable: true,
        draggablePercent: 0.4,
        showCloseButtonOnHover: false,
        hideProgressBar: false,
        closeButton: false,
        rtl: false,
      };

      this.$toast.success(content, options);

    },

    showResponseFailed (payload) {
      let uuid = null;
      if (!payload.id) {
        uuid = uuidv4();
      } else {
        uuid = payload.id;
      }

      let content = {
        component: Alert,
        props: {
          id: uuid,
          type: 'error',
          title: 'Failed',
          description: payload.description,
        },
        listeners: {
          close: (id) => {
            this.$toast.dismiss(id);
          },
        },
      };
      let options = {
        id: uuid,
        position: 'bottom-left',
        timeout: payload.persistent ? 0 : 2000,
        closeOnClick: true,
        draggable: true,
        draggablePercent: 0.4,
        showCloseButtonOnHover: false,
        hideProgressBar: false,
        closeButton: false,
        rtl: false,
      };

      this.$toast.error(content, options);

    },

    showResponseError (e) {

      let uuid = null;
      if (!e.id) {
        uuid = uuidv4();
      } else {
        uuid = e.id;
      }

      let content = {
        component: Alert,
        props: {
          id: uuid,
          type: 'error',
          title: 'Something broke',
          description: e.description ?? 'Something went wrong. If this keeps happening please file a bug report.',
          buttons: [
            { text: 'File Bug Report', type: 'secondary', loadingOnClick: false, action: () => {this.goto_url_tab('https://github.com/AMRC-FactoryPlus/acs-manager/issues/new');} },
          ],
        },
        listeners: {
          close: (id) => {
            this.$toast.dismiss(id);
          },
        },
      };
      let options = {
        id: uuid,
        position: 'bottom-left',
        timeout: 0,
        closeOnClick: true,
        draggable: true,
        draggablePercent: 0.4,
        showCloseButtonOnHover: false,
        hideProgressBar: false,
        closeButton: false,
        rtl: false,
      };

      this.$toast.error(content, options);

    },

    hideNotification (payload) {
      this.$toast.dismiss(payload.id);
    },

  },

  data () {
    return {};
  },
};
</script>
