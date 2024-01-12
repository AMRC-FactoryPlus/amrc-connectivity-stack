<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\EdgeClusters\Actions\CreateEdgeClusterAction;
use App\Domain\EdgeClusters\Actions\GetBootstrapScriptForEdgeClusterAction;
use App\Domain\EdgeClusters\Actions\GetEdgeClustersAction;
use App\Http\Requests\CreateEdgeClusterRequest;

class EdgeClusterController extends Controller
{
    public function index()
    {
        if (\request()->wantsJson()) {
            return process_action((new GetEdgeClustersAction())->execute());
        }

        $initialData = [
            'edgeClusters' => ['value' => null, 'method' => 'get', 'url' => '/api/edge-clusters',],
            'helmChartTemplates' => ['value' => null, 'method' => 'get', 'url' => '/api/helm-chart-templates',],
            'defaultHelmChartTemplates' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/default-helm-chart-templates',
            ],
        ];

        // Return the view with the initial data
        return view('edge-clusters', ['initialData' => $initialData,]);
    }

    public function create(CreateEdgeClusterRequest $request)
    {
        $validated = $request->validated();

        return process_action(
            (new CreateEdgeClusterAction())->execute(name: $validated['name'], chart: $validated['chart'])
        );
    }

    public function bootstrapCommand()
    {
        return process_action((new GetBootstrapScriptForEdgeClusterAction())->execute(request()->route('cluster')));
    }
}
