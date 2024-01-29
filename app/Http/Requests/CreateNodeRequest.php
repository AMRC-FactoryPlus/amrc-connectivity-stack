<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateNodeRequest extends FormRequest
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

    /*
     * These are required to get the Stringified JSON data back into an array before validation.
     * See https://stackoverflow.com/questions/53603342/validate-parameters-as-a-json-string-in-laravel
     * Required because we add FormData from JS
     */

    public function validator($factory)
    {
        return $factory->make(
            $this->sanitize(),
            $this->container->call([$this, 'rules']),
            $this->messages()
        );
    }

    public function sanitize()
    {
        return $this->all();
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'node_name' => ['required', 'string', 'min:5', 'regex:/^\w+$/i'],
            'charts' => ['required', 'string'],
            'destination_cluster' => ['required', 'string'],
            'destination_node' => ['string', 'nullable'],
        ];
    }
}
