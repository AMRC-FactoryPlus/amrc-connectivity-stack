<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Meta\Requests;

    use Illuminate\Foundation\Http\FormRequest;

    /**
     * @property mixed meta
     */
    class ResetMetaRequest extends FormRequest
    {
        /**
         * Determine if the user is authorized to make this request.
         *
         * @return bool
         */
        public function authorize()
        {
            return true;
        }

        /**
         * Get the validation rules that apply to the request.
         *
         * @return array
         */
        public function rules()
        {
            return [
                'meta' => [
                    'required',
                    'string',
                ],
            ];
        }
    }
