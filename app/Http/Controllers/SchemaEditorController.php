<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class SchemaEditorController extends Controller
{
    public function index()
    {
        $initialData = [
            'deviceSchemas' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/device-schemas',
            ],
            'deviceSchemaVersions' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/device-schemas/{schema}/versions',
            ],
        ];

        // Return the view with the initial data
        return view('schema-editor', [
            'initialData' => $initialData,
        ]);
    }
}
