<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="grid gap-4">
    <div class="grid gap-2">
      <Label for="objectName">Name</Label>
      <Input
          id="objectName"
          v-model="localValue"
          placeholder="Enter name for the new entry"
          @keyup.enter="validateAndCreate()"/>
      <div v-if="v.$errors.length" class="text-red-500 text-sm">
        <div v-for="(error, index) in v.$errors" :key="index">
          {{ error.$message }}
        </div>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" @click="$emit('close')">
        Cancel
      </Button>
      <Button
          @click="validateAndCreate()"
          :disabled="v.$invalid">
        Add
        <i class="fa-sharp fa-solid fa-plus ml-2"></i>
      </Button>
    </DialogFooter>
  </div>
</template>

<script>
import useVuelidate from '@vuelidate/core';
import { required, minLength, helpers } from '@vuelidate/validators';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogFooter } from '@/components/ui/dialog';

export default {
  setup () {
    return { v: useVuelidate() };
  },

  name: 'NewObjectOverlayForm',

  components: {
    Button,
    Input,
    Label,
    DialogFooter,
  },

  props: {
    regex: { required: true },
    objectType: {
      type: String,
      required: false,
      default: 'Object'
    },
  },

  methods: {
    validateAndCreate() {
      this.v.$touch();
      if (!this.v.$invalid && this.localValue) {
        this.$emit('create', this.localValue);
        this.localValue = null;
      }
    },
    create() {
      this.validateAndCreate();
    }
  },

  data () {
    return {
      localValue: '',
    };
  },

  validations () {
    // Create a safe regex validator function
    const safeRegexValidator = (value) => {
      try {
        const regexPattern = new RegExp(this.regex);
        return regexPattern.test(value);
      } catch (e) {
        console.error('Invalid regex pattern:', e);
        return false;
      }
    };

    return {
      localValue: {
        required: helpers.withMessage('Name is required', required),
        minLength: helpers.withMessage('Name must be at least 1 character', minLength(1)),
        pattern: helpers.withMessage(`Invalid name format (must match ${this.regex})`, safeRegexValidator)
      }
    };
  },
};
</script>

