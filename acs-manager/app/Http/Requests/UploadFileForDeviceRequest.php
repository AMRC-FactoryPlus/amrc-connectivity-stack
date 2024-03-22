<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UploadFileForDeviceRequest extends FormRequest
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
            'instance_uuid' => 'required|string',
            'file_type_key' => 'required|string',
            'friendly_title' => 'required|string',
            'friendly_description' => '',
            'uploader' => 'required|string',
            'file' => 'required|file',
            'tags' => 'string',
        ];
    }
}
