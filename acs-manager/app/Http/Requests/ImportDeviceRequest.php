<?php
/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ImportDeviceRequest extends FormRequest
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
            'node_id' => 'required|exists:nodes,id',
            'connections' => ['required', 'array'],
            'connections.*.name' => ['required', 'string'],
            'connections.*.connType' => ['required', 'string'],
            'connections.*.devices' => ['required', 'array'],
            'connections.*.devices.*.deviceId' => ['required', 'string'],
            'connections.*.devices.*.tags' => ['required', 'array'],
            'connections.*.devices.*.tags.*.Name' => ['required', 'string'],
        ];
    }
}
