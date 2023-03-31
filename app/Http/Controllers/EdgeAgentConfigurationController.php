<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Auth\Actions\AuthenticateKerberosPrincipalAction;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;
use App\Http\Requests\GetEdgeAgentConfigurationRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class EdgeAgentConfigurationController extends Controller
{
    public function show(GetEdgeAgentConfigurationRequest $request)
    {
        // Authenticate the request
        $validated = $request->validated();

        // Get the node
        $node = Node::where('uuid', $validated['node_id'])->first();
        if (! $node) {
            throw new ActionFailException(
                'The node does not exist.', 404
            );
        }

        (new AuthenticateKerberosPrincipalAction)->execute($node->principal, $validated['config_password']);

        if ($node->activeEdgeNodeConfiguration === null) {
            throw new ActionFailException(
                'This node does not have an active Edge Agent configuration. Ensure that it has both an active Origin Map and an active Device Connection in the Factory+ manager.'
            );
        }

        return action_success(Storage::disk('edge-agent-configs')->get($node->activeEdgeNodeConfiguration->file));
    }
}
