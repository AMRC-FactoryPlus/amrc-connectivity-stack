<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <overlay
      :show="show"
      @close="$emit('close')"
      title="Manage Users">
    <template
        #content>
      <div class="flex-1 flex items-center justify-between text-left bg-white truncate mt-2 hover:!bg-gray-100 p-3 text-gray-900" v-for="user in node.accessible_by">
        <div>{{user}}</div>
        <button type="button"
                class="fpl-button-error"
                @click="() => {}">
          <div class="mr-2">Remove Access</div>
          <i class="fa-sharp fa-solid fa-trash text-xs"></i>
        </button>
      </div>
      <h2 class="font-bold text-brand ml-3 mt-6 mb-3">
        Add User
      </h2>
        <div class="flex items-center justify-center gap-2">
          <Wrapper>
            <template #description>
              Grant a user permission to configure devices in this node. You must specify the full username, including the domain.
            </template>
            <template #content>
              <Input
                  :control="{}"
                  :valid="{}"
                  placeholder="e.g. admin@<REALM>"
                  v-model="username"></Input>
            </template>
          </Wrapper>
          <button type="button"
                  class="fpl-button-error flex-shrink-0 h-10"
                  @click="grantAccess">
            <div class="mr-2">Grant Access</div>
            <i class="fa-sharp fa-solid fa-plus text-xs"></i>
          </button>
        </div>
    </template>
  </overlay>
</template>

<script>

export default {
  name: 'NodeUserOverlay',
  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
  },
  props: {
    /**
    * Whether or not to show the overlay
    */
    show: {
      required: true,
      type: Boolean
    },

    /**
     * The node to manage users for
     */
    node: {
      required: true,
      type: Object,
    },

    /**
    * The group that the node sits in
    */
    group: {
      required: true,
      type: Object
    },
  },

  methods: {
    grantAccess() {

      axios.post(`/api/groups/${this.group.id}/nodes/${this.node.id}/users`, {
        user: this.username,
      }).then(e => {
        window.showNotification({
          title: 'Access granted',
          description: 'The user has been given access to this node.',
          type: 'success'
        });
        this.requestDataReloadFor('nodes');
        this.$emit('close');
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      })
    }
  },

  data () {
    return {
      username: null,
    }
  },
}
</script>

