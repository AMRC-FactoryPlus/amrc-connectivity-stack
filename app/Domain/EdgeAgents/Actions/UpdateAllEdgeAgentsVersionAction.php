<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeAgents\Actions;

use App\Exceptions\ActionForbiddenException;

use function func_get_args;

class UpdateAllEdgeAgentsVersionAction
{
    public function execute(string $version)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $deployments = (new GetDeployedEdgeAgentsAction)->execute()['data'];

        foreach ($deployments as $deployment) {
            (new UpdateEdgeAgentVersionAction)->execute($deployment->getName(), $deployment->getNamespace(), $version);
        }

        return action_success();
    }

    /**
     * This action patches all edge agent deployments with the supplied edge agent version
     **/
    private function authorise()
    {
        if (! auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can create new groups.');
        }
    }

    private function validate()
    {
    }
}
