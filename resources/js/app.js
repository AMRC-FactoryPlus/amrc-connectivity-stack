/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

/**
 * First we will load all of this project's JavaScript dependencies which
 * includes Vue and other libraries. It is a great starting point when
 * building robust, powerful web applications using Vue and Laravel.
 */

import './bootstrap';
import '../css/app.css';

import Vue from 'vue';
import VTooltip from 'v-tooltip';
import moment from 'moment';

import Toast from 'vue-toastification';
import 'vue-toastification/dist/index.css';
const toastOptions = {
  transition: 'fade-fpl',
  icon: false,
};
Vue.use(Toast, toastOptions);



Vue.prototype.moment = moment;

Vue.use(VTooltip);

// Alerts
Vue.component('notification', () => import(/* webpackPrefetch: true */ './components/Alert/Notification.vue'));

// Auth
Vue.component('login-page', () => import(/* webpackPrefetch: true */ './components/Auth/LoginPage.vue'));
Vue.component('reauthenticate', () => import(/* webpackPrefetch: true */ './components/Auth/Reauthenticate.vue'));

// Layouts
Vue.component('dashboard', () => import(/* webpackPrefetch: true */ './components/Layouts/Dashboard.vue'));

// Pages
Vue.component('node-container', () => import(/* webpackPrefetch: true */ './components/Containers/NodeContainer.vue'));
Vue.component('device-editor-container', () => import(/* webpackPrefetch: true */ './components/Containers/DeviceEditorContainer.vue'));
Vue.component('schema-editor-container', () => import(/* webpackPrefetch: true */ './components/Containers/SchemaEditorContainer.vue'));
Vue.component('edge-cluster-container', () => import(/* webpackPrefetch: true */ './components/Containers/EdgeClusterContainer.vue'));

// Components
Vue.component('Loader', () => import(/* webpackPrefetch: true */ './components/General/Loader.vue'));
Vue.component('Input', () => import(/* webpackPrefetch: true */ './components/FormControls/Input.vue'));
Vue.component('Wrapper', () => import(/* webpackPrefetch: true */ './components/FormControls/Wrapper.vue'));
Vue.component('OverflowMenu', () => import(/* webpackPrefetch: true */ './components/OverflowMenu.vue'));

// Account
Vue.component('Preferences', () => import(/* webpackPrefetch: true */ './components/Containers/PreferencesContainer.vue'));


import.meta.glob([
  '../assets/img/**',
]);

// ====================== //
// ALERTS & NOTIFICATIONS //
// ====================== //
window.events = new Vue();
window.showNotification = (payload) => {
  window.events.$emit('showNotification', payload);
};
window.showResponseSuccess = (payload) => {
  window.events.$emit('showResponseSuccess', payload);
};
window.showResponseFailed = (payload) => {
  window.events.$emit('showResponseFailed', payload);
};
window.showResponseError = (e, notificationId) => {
  window.events.$emit('showResponseError', e);
};

window.hideNotification = (payload) => {
  window.events.$emit('hideNotification', payload);
};

/**
 * Next, we will create a fresh Vue application instance and attach it to
 * the page. Then, you may begin adding components to this application
 * or customize the JavaScript scaffolding to fit your unique needs.
 */

Vue.mixin({

  mounted () {
    if (this.isContainer === true) {
      this.printDebug('This component is a container. Skipping data request event broadcast.');
    } else {
      // Both initialise the component (in case we were loaded after the container and the data is ready)...
      this.initialiseChildComponent();
      // And register to initialise once the container announces that it is ready (in case we load before it)
      window.events.$on('initialDataReady', () => {
        this.initialiseChildComponent();
      });
    }
  },

  methods: {
    
    handleError(error, notificationId = null) {
      
      if (error && error.response && error.response.status === 401) {
        this.goto_url('/login');
      }
      
      if (error && error.response && error.response.status >= 500) {
        window.showResponseError({
          id: notificationId,
          description: error?.response?.data?.message,
        });
      } else if (error.response && error.response.data && 'message' in error.response.data) {
        window.showResponseFailed({
          id: notificationId,
          description: error.response.data.message,
        });
      } else if (error.response && error.response.data && 'data' in error.response.data) {
        window.showResponseFailed({
          id: notificationId,
          description: error.response.data.data[Object.keys(error.response.data.data)[0]][0],
        });
      } else {
        window.showResponseFailed({
          id: notificationId,
          description: 'Could not parse error.',
        });
      }
    },

    // Container Methods
    initialiseContainerComponent () {
      for (const [key, value] of Object.entries(this.initialData)) {
        // If we don't have a method and a url key, then we're presuming the data contained is a static value, so we assign it.
        if ((!('method' in value) && !('url' in value))) {
          this[key] = value;
          this[key + 'Loaded'] = true;
          continue;
        }

        // Print a warning if initialData contains properties that we have not initialised on the component.
        if (!(key in this)) {
          console.error(key + ' is missing from the container\'s data object.');
        }
        if (!((key + 'Loaded') in this)) {
          console.error(key + 'Loaded is missing from the container\'s data object.');
        }
        if (!((key + 'Loading') in this)) {
          console.error(key + 'Loading is missing from the container\'s data object.');
        }

        // If we do have a method and url key but want to statically assign the value in the first instance, look for the initiallyAssign key
        if (('initiallyAssign' in value && value['initiallyAssign'] === true)) {
          this[key] = value['value'];
          this[key + 'Loaded'] = true;
        } else {
          // Initialise the values of the properties
          this[key] = null;
          this[key + 'Loaded'] = false;
          this[key + 'Loading'] = false;
        }

        // If we have a way of getting the data, we need to register listeners so that any of our child components can ask for it.
        // This listener has additional protection to ensure that the data is not loaded many times when all the components come online
        window.events.$on('initialiseData-' + key, (params) => {
          this.handleInitialiseDataRequest(key, value, params.queryBank, params.routeVar);
        });

        // This listener skips the checks as this event should be emitted in a much more controlled manner
        window.events.$on('reloadData-' + key, (params) => {
          this.handleReloadDataRequest(key, params.queryBank, params.routeVar, params.actionOnComplete);
        });

        // If we are asking the container to get the data immediately, then do that.
        if (this[key + 'ForceLoad'] === true) {
          // If we are already loading the data or we already have it, ignore the request.
          if (this[key + 'Loaded'] || this[key + 'Loading']) {
            this.printDebug('Trying to force load ' + key + ' when loading already in progress. Ignoring.');
            continue;
          }
          // Otherwise, we are good to load the data.
          this.printDebug('Component has asked to force load ' + key + '.');
          this.reloadDataFor(key);
        }
        this.printDebug('' + key + ' ready for data requests');

      }
      this.printDebug('All properties ready for data requests');

      window.events.$emit('initialDataReady');
    },
    handleInitialiseDataRequest (key, value, queryBank = null, routeVar = null) {
      // If we have defined a propertyIgnoreInitialiseCache on the component then reload it anyway
      if (!((key + 'IgnoreInitialiseCache') in this && this[key + 'IgnoreInitialiseCache'])) {
        // If we get a request and we are already loading the data or we already have it, ignore the request.
        if (this[key + 'Loaded'] || this[key + 'Loading']) {
          this.printDebug('Received multiple requests to initialise ' + key + '. Ignoring.');
          return;
        }
      }
      // Otherwise, we are good to load the data.
      this.printDebug('Initial Data request for ' + key + ' received' + (queryBank ? ' with QueryBank ' : '') + (routeVar ? ' and with routeVar' : ''));

      // Update the container's query bank to the one supplied
      if (queryBank) {
        this.printDebug('Updating global queryBank values for ' + key + '.');
        this[key + 'QueryBank'] = queryBank;
      }

      // Update the container's routeVar to the one supplied
      if (routeVar) {
        this.printDebug('Updating global routeVar values for ' + key + '.');
        this[key + 'RouteVar'] = routeVar;
      }

      this.reloadDataFor(key, this[key + 'QueryBank'], this[key + 'RouteVar'], true);
    },

    handleReloadDataRequest (key, queryBank = null, routeVar = null, actionOnComplete = () => {}) {

      // Only reload if a reload is not already in progress
      if (this[key + 'Loading']) {
        this.printDebug('Request already in progress to reload ' + key + '. Ignoring.');
        return;
      }

      this.printDebug('Data request for ' + key + ' received.');

      // Update the container's query bank to the one supplied
      if (queryBank) {
        this.printDebug('Updating global queryBank values for ' + key + '.');
        this[key + 'QueryBank'] = queryBank;
      }

      // Update the container's routeVar to the one supplied
      if (routeVar) {
        this.printDebug('Updating global routeVar values for ' + key + '.');
        this[key + 'RouteVar'] = routeVar;
      }

      this.reloadDataFor(key, this[key + 'QueryBank'], this[key + 'RouteVar'], false, actionOnComplete);
    },

    reloadDataFor (property, queryBank = null, routeVar = null, initial = false, actionOnComplete = () => {}) {

      // Fire an event to let all interested parties know that the data is incoming
      window.events.$emit('dataLoading-' + property);

      if (initial) {
        window.events.$emit('initialDataLoading-' + property);
      }

      // Set the property as loading on the container
      this[property + 'Loading'] = true;

      // Get the data
      let self = this;
      let queryString = '';
      if (typeof queryBank === 'string' && queryBank !== null) {
        // We've been given a direct query string - use that.
        queryString = queryBank;
      } else if (typeof queryBank === 'object' && queryBank !== null) {
        // We've been given a queryBank - use that.
        queryString = this.buildQueryStringFromBank(queryBank);
      } else {
        // We haven't been given a query bank so use the master query bank on the container
        queryString = this.buildQueryStringFromBank(this[property + 'QueryBank'] || {});
      }
      let method = this.initialData[property].method;
      let url = this.initialData[property].url;

      // Replace any dynamic {} elements in the URL with supplied values
      if (routeVar) {
        for (const [key, value] of Object.entries(routeVar)) {
          const replace = '\{' + key + '\}';
          const re = new RegExp(replace, 'g');
          url = url.replace(re, value);
        }
      }
      
      this.makeRequest(method, url, queryString, property, this, initial, actionOnComplete);
      
    },
    
    makeRequest(method, url, queryString, property, self, initial, actionOnComplete) {
      return new Promise((resolve, reject) => {
        const attemptRequest = () => {
          axios[method](url + queryString).then(response => {
            self[property] = response.data.data;
            self[property + 'Loaded'] = true;
            this[property + 'Loading'] = false;
            window.events.$emit('dataLoaded-' + property);
            if (initial) {
              window.events.$emit('initialDataLoaded-' + property);
            }
            actionOnComplete();
            resolve(response);
          }).catch(error => {
            if (error?.response?.data?.data?.reauthenticate) {
              // Show the reauthenticate modal
              window.events.$emit('show-reauthenticate-modal', () => {
                attemptRequest(); // Retry the request after reauthentication
              });
            } else {
              if (error && error.response && error.response.status === 401) {
                this.goto_url('/login');
              }
              window.events.$emit('dataLoaded-' + property);
              if (initial) {
                window.events.$emit('initialDataLoaded-' + property);
              }
              self[property + 'Loaded'] = false;
              self[property + 'Loading'] = false;
              
              this.handleError(error);
              reject(error);
            }
          });
        };
        
        attemptRequest();
      });
    },
    
    buildQueryStringFromBank (bank) {
      let queryStringBuilder = '?';

      for (const [key, value] of Object.entries(bank)) {
        queryStringBuilder += (value + '&');
      }
      return queryStringBuilder;
    },

    // Child Methods
    initialiseChildComponent () {
      // By default, a child component is required to have a prop and a propLoaded data object to qualify for the right to request initial data
      if (this.$props) {
        for (const [key, value] of Object.entries(this.$props)) {
          if (key + 'Loading' in this.$data) {
            // Register listener events for loading and loaded for all properties that also have a propertyLoaded property to render loading states
            window.events.$on('dataLoading-' + key, () => {
              this[key + 'Loading'] = true;
            });
            window.events.$on('initialDataLoading-' + key, () => {
              this[key + 'InitiallyLoading'] = true;
            });
            window.events.$on('dataLoaded-' + key, () => {
              this[key + 'Loading'] = false;
            });
            window.events.$on('initialDataLoaded-' + key, () => {
              this[key + 'InitiallyLoading'] = false;
            });
            // We're ready for the data. Ask the container to fetch it for us (include the queryBank for the key if we have it, otherwise it's null)
            if (!this[key + 'PreventLoad']) {
              // If the route to fetch the data is dynamic then we need to let the container know the value to substitute by using a keyRouteVar property.
              window.events.$emit('initialiseData-' + key, {
                queryBank: this[key + 'QueryBank'],
                routeVar: (key + 'RouteVar' in this) ? this[key + 'RouteVar'] : null,
              });
            }
          }
        }
      }
    },
    requestDataReloadFor (property, queryBank = {}, routeVar = null, actionOnComplete = () => {}) {

      window.events.$emit('reloadData-' + property, {
        queryBank: queryBank || ((property + 'QueryBank' in this) ? this[property + 'QueryBank'] : null),
        routeVar: routeVar || ((property + 'RouteVar' in this) ? this[property + 'RouteVar'] : null),
        actionOnComplete: actionOnComplete,
      });
    },

    // Convenience Methods
    goto_url_tab (url) {
      window.open(
        url,
        '_blank', // Open in a new tab
      );
    },

    // This function recursively converts from an array of nested keys to the object
    resolve (a, o) {
      if (!Array.isArray(a)) { a = [a];}
      for (var i = 0, n = a?.length; i < n; ++i) {
        var k = a[i];
        if (k in o) {
          o = o[k];
        } else {
          return;
        }
      }
      return o;
    },

    goto_url (url) {
      window.location.href = url;
    },

    activateDefaultTab (defaultIfQueryMissing) {
      const urlParams = new URLSearchParams(window.location.search);
      const myParam = urlParams.get('tab');
      if (myParam) {
        this.selectTab(myParam);
      } else {
        this.selectTab(defaultIfQueryMissing);
      }
    },

    selectTab (tabName, quiet = false) {
      if (!this.baseTitle) {
        this.baseTitle = window.document.title;
      }
      window.document.title = this.baseTitle + ' | ' + tabName;
      if (!quiet) {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('tab', tabName);
        window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
      }
      this.selectedTab = tabName;
    },

    clearRouteParam (param, urlParams = null) {
      if (!urlParams) {
        urlParams = new URLSearchParams(window.location.search);
      }
      urlParams.delete(param);
      window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
    },

    printDebug (message) {
      console.debug('===API=== (' + this.$options.name + ') ' + message);
    },
  },
});

const app = new Vue({
  el: '#app',
  validations: {},

  mounted () {
    this.$nextTick(() => {
      window.addEventListener('resize', this.onResize);
    });
    window.onload = function () {
      window.events.$emit('document-loaded');
    };
  },

  data: {
    initialData: {},
    initialDataLoading: null,
    initialDataLoaded: false,
    userPreferences: JSON.parse(document.querySelector('meta[name=\'userPreferences\']').getAttribute('content')),
    appEnv: document.querySelector('meta[name=\'appEnv\']').getAttribute('content'),
    windowWidth: window.innerWidth,
    baseTitle: null,
    user: JSON.parse(document.querySelector('meta[name=\'user\']').getAttribute('content')),
  },
});
