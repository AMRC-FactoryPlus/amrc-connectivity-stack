<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\EdgeAgents\Actions\GetDeployedEdgeAgentsAction;
use App\Domain\EdgeAgents\Actions\UpdateAllEdgeAgentsVersionAction;
use App\Domain\EdgeAgents\Actions\UpdateEdgeAgentVersionAction;
use App\Http\Requests\UpdateEdgeAgentVersionRequest;

class EdgeAgentController extends Controller
{
    public function index()
    {
        if (\request()->wantsJson()) {
            return process_action((new GetDeployedEdgeAgentsAction)->execute());
        }

        $initialData = [
            'edgeAgents' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/edge-agents',
            ],
        ];

        // Return the view with the initial data
        return view('edge-agents', [
            'initialData' => $initialData,
        ]);
    }

    public function update(UpdateEdgeAgentVersionRequest $request)
    {
        $validated = $request->validated();

        return process_action(
            (new UpdateEdgeAgentVersionAction)->execute(request()->route('name'), request()->route('namespace'), $validated['version'])
        );
    }

    public function updateAll(UpdateEdgeAgentVersionRequest $request)
    {
        $validated = $request->validated();

        return process_action(
            (new UpdateAllEdgeAgentsVersionAction)->execute($validated['version'])
        );
    }
}
