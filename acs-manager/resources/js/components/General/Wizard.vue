<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="z-50 flex-grow flex flex-col transform ease-in-out transition-all duration-100 overflow-y-auto -mx-10 -mb-6">

    <div>
      <!--Main Content-->
      <div id="tagline" v-if="'tagline' in steps[currentStep]" class="mx-10 border-red-500 mb-6">
        <h2>{{ steps[currentStep].tagline }}</h2>
      </div>
      <div id="controls" class="flex flex-col mx-10 mb-6">
        <form-control class="mb-6" v-if="control" @valueUpdated="processUpdatedValue(index, $event)" @navigation="handleButtonClick($event)"
                      v-bind:key="index" v-for="(control,index) in
                    steps[currentStep].controls" :control="control" :steps="steps" :valid="v$.currentStepContent.controls[index]"
                      @keyUpEnter="handleButtonClick(steps[currentStep].buttons.filter(e => e.primary === true)[0].actionMethod)"/>
      </div>

      <!--Action Navigation-->
      <div class="h-20 flex-shrink-0 -b-lg bg-gray-100 flex items-center justify-between px-10">
        <button v-if="('previousStep' in steps[currentStep])" @mouseup="previousStep"
                class="flex fpl-button-back h-12 -mx-6">
          <i class="fa-sharp fa-solid fa-arrow-left text-base w-16"></i>
        </button>
        <button :disabled="v$.$invalid || submitting"
                v-for="button in steps[currentStep].buttons" @mouseup="handleButtonClick(button.actionMethod)"
                class="fpl-button-brand h-12 -mx-6" :class="{'ml-auto' : !('previousStep' in steps[currentStep])}">
          <div v-if="submitting === false" class="text-base mr-3 ml-10" v-text="button.text"></div>
          <i v-if="submitting === false" class="mr-10" :class="button.icon"></i>
          <div v-else class="w-12">
            <i class="fa-sharp fa-solid fa-circle-notch fa-spin"></i>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core'

export default {
  setup () {
    return { v$: useVuelidate() }
  },

  name: 'Wizard',

  components: {
    'form-control': () => import(/* webpackPrefetch: true */ './FormControl.vue'),
  },

  props: {
    dataSteps: { required: true },
    dataFirstStep: { required: true, type: String },
  },

  computed: {
    currentStepContent () {
      return this.steps[this.currentStep];
    },
  },

  watch: {
    currentStep (newVal, oldVal) {
      this.triggerOnLoad(newVal);
      this.triggerStartAction(newVal);

      // We could have an issue going backwards here when the next step (prev going backwards) runs it's endAction. Should detect direction
      this.triggerEndAction(oldVal);
    },
  },

  mounted () {
    this.triggerOnLoad(this.currentStep);
  },

  methods: {
    triggerOnLoad (step) {
      if (typeof this.steps[step].onLoad === 'function') {
        this.printDebug('Running onLoad for ' + step + ' step.');
        this.steps[step].onLoad(this.steps);
      }
    },

    triggerStartAction (step) {
      let stepContent = this.steps[step];
      // See if the current step has a startAction
      if ('startAction' in stepContent && typeof stepContent.startAction === 'function') {
        this.printDebug('Running startAction for ' + step + ' step.');
        stepContent.startAction(stepContent);
      }
    },

    triggerEndAction (step) {
      let stepContent = this.steps[step];
      // See if the current step has an endAction
      if ('endAction' in stepContent && typeof stepContent.endAction === 'function') {
        this.printDebug('Running endAction for ' + step + ' step.');
        stepContent.endAction(stepContent);
      }
    },

    cancel () {
      this.$emit('cancel');
    },
    completed (response) {
      this.setStep(this.dataFirstStep);
      Object.keys(this.steps).filter(stepKey => {return !('url' in this.steps[stepKey]);}).forEach(e => {
        Object.keys(this.steps[e].controls).forEach(controlKey => {
          this.steps[e].controls[controlKey].value = this.steps[e].controls[controlKey].initialValue;
        });
      });
      this.v$.$reset();
      this.$emit('complete', response);
    },

    failed () {
      this.$emit('fail');
    },
    setStep (step) {
      this.currentStep = step;
    },

    handleButtonClick (event) {
      if (!this.v$.$invalid) {
        this[event]();
      }
    },

    nextStep () {
      if (this.v$.$invalid) {
        return;
      }

      let stepToMoveTo = this.currentStepContent.nextStep;
      let skipThis = true;

      do {
        skipThis = this.skipStepCheck(stepToMoveTo);
        if (skipThis) {
          stepToMoveTo = this.steps[stepToMoveTo].nextStep;
        }

      } while (skipThis === true);

      this.setStep(stepToMoveTo);
    },

    skipStepCheck (step) {
      if ('skipStepIf' in this.steps[step]) {
        let skipParams = this.steps[step].skipStepIf;

        // If we just have a raw function then use that
        if (typeof skipParams === 'function') {
          if (!!skipParams() === true) {
            return true;
          }
          return false;
        }

        if (this.steps[skipParams.step].controls[skipParams.control].value === skipParams.value) {
          return true;
        } else {
        }
      }
      return false;
    },

    previousStep () {
      if (!('previousStep' in this.steps[this.currentStep])) {
        return;
      }

      let stepToMoveTo = this.currentStepContent.previousStep;
      let skipThis = true;
      do {
        skipThis = this.skipStepCheck(stepToMoveTo);
        if (skipThis) {
          stepToMoveTo = this.steps[stepToMoveTo].previousStep;
        }

      } while (skipThis === true);

      this.setStep(stepToMoveTo);
    },

    submit: function () {

      if ('startAction' in this.steps.__request) {
        this.triggerStartAction('__request');
      }

      this.submitting = true;

      let vm = this;

      const config = { headers: { 'Content-Type': 'multipart/form-data' } };
      this.formData = new FormData();

      let requestInfo = this.dataSteps.__request;

      for (const [key, value] of Object.entries(requestInfo.parameters)) {
        let skipParams = value.skipIf;
        if (typeof skipParams === 'function') {
          if (!!skipParams() === true) {
            continue;
          }
        }
        this.addFormData(key, value);
      }

      axios[requestInfo.type](requestInfo.url, this.formData, config).then((response) => {
        vm.submitting = false;
        vm.cancel();
        vm.currentStep = vm.dataFirstStep;
        vm.completed(response);
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        vm.failed();
        vm.submitting = false;
        vm.handleError(error);
      });
    },

    processUpdatedValue (key, event) {
      // This takes the new value and embeds it in the value property of the step, which we have cloned from the parent.
      this.steps[this.currentStep].controls[key].value = event;

      // Then we set it to dirty, which performs the validation
      this.v$.currentStepContent.controls[key].value.$touch();

      // If we have an onChange event, fire it and pass the new value.
      if (typeof this.steps[this.currentStep].controls[key].onChange === 'function') {
        this.printDebug('Running onChange for ' + key + ' step.');
        this.steps[this.currentStep].controls[key].onChange(this.steps[this.currentStep].controls[key].value);
      }
    },

    addFormData: function (key, value) {
      switch (value.dataType) {
        case 'collected':
          // If we have a translator loaded, use it
          let val = this.processTranslation(value);
          if (val) {
            this.formData.append(key, val);
          }
          return;

        case 'rendered':
          // Here go through the entire object, fetch the required data and add to a new object that will be stringified.
          let newObject = {}; // This holds the data that will be stringified and sent to the server
          for (const [key_l2, value_l2] of Object.entries(value)) {
            // If we have a dataSource property, we can get the value and add it to the object
            if (typeof value_l2 === 'object' && 'dataSource' in value_l2) {
              newObject[key_l2] = this.processTranslation(value_l2);
            } else {
              for (const [key_l3, value_l3] of Object.entries(value_l2)) {
                if (typeof value_l3 === 'object' && 'dataSource' in value_l3) {
                  // Set L2 if it doesn't exist
                  newObject[key_l2] = newObject[key_l2] ? newObject[key_l2] : {};
                  newObject[key_l2][key_l3] = this.processTranslation(value_l3);

                }
              }
            }
          }
          this.formData.append(key, JSON.stringify(newObject));
          return;

        case 'static_rendered':
          // Here go through the entire object, fetch the required data and add to a new object that will be stringified.
          let newObjectSR = {}; // This holds the data that will be stringified and sent to the server
          for (const [key_l2, value_l2] of Object.entries(value)) {
            // If we have a dataSource property, we can get the value and add it to the object
            newObjectSR[key_l2] = value_l2.data;
          }
          this.formData.append(key, JSON.stringify(newObjectSR));
          return;

        case 'static':
          this.formData.append(key, value.data);
          return;
      }
    },

    processTranslation: function (value) {
      if ('translator' in value) {
        let paramContent = [];
        var suppliedData = this.resolve(value.dataSource, this.dataSteps);
        switch (value.translator.type) {
          case 'arrayOfObjects' :
            suppliedData.forEach((element) => {
              let returnData = {};
              for (const [key, value] of Object.entries(value.translator.fields)) {
                returnData[key] = this.resolve(value, element);
              }
              paramContent.push(returnData);
            });
            return JSON.stringify(paramContent);
          case 'arrayOfStrings' :
            suppliedData.forEach((element) => {
              paramContent.push(element);
            });
            return paramContent;
          case 'invert' :
            return !suppliedData;
          case 'multiply' :
            return suppliedData * value.translator.multiplier;
          case 'bool' :
            return Number(suppliedData);

          default:
            console.error('Request form translator not recognised.');
            break;
        }
      } else {
        return this.resolve(value.dataSource, this.dataSteps);
      }
    },
  },

  data () {
    return {
      steps: this.dataSteps,
      currentStep: this.dataFirstStep,
      submitting: false,
      formData: null,
    };
  },

  validations () {
    let returnObj = {
      currentStepContent: {
        controls: {},
      },
    };

    // Build up validation array for current step
    for (const [key, value] of Object.entries(this.steps[this.currentStep].controls)) {
      returnObj.currentStepContent.controls[key] = {
        value: value.validations,
      };
    }
    return returnObj;
  },
};
</script>

