<?php

/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

class DashboardController extends Controller
{
    public function nodes()
    {
        $initialData = [
            'groups' => ['value' => null, 'method' => 'get', 'url' => '/api/groups',],
            'nodes' => ['value' => null, 'method' => 'get', 'url' => '/api/groups/{group}/nodes',],
            'devices' => ['value' => null, 'method' => 'get', 'url' => '/api/groups/{group}/nodes/{node}/devices',],
            'roles' => ['value' => null, 'method' => 'get', 'url' => '/api/roles',],
            'edgeClusters' => ['value' => null, 'method' => 'get', 'url' => '/api/edge-clusters',],
            'helmChartTemplates' => ['value' => null, 'method' => 'get', 'url' => '/api/helm-chart-templates',],
            'defaultHelmChartTemplates' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/default-helm-chart-templates',
            ],
        ];

        // Return the view with the initial data
        return view('nodes', ['initialData' => $initialData,]);
    }

    public function roles()
    {
        return view('roles');
    }

    public function users()
    {
        return view('users');
    }

    public function preferences()
    {
        return view('preferences');
    }
}
