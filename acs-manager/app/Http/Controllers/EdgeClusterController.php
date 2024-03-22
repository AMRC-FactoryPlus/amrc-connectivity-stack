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
        return process_action((new GetEdgeClustersAction())->execute());
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
