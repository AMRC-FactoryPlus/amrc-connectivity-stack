<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDeviceOriginMapRequest extends FormRequest
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

            'configuration' => 'required|json',
            'activate' => 'required|boolean',
            'device_schema_id' => 'required|exists:device_schemas,id',
            'schema_uuid' => 'required|exists:device_schema_versions,schema_uuid',
        ];
    }
}
