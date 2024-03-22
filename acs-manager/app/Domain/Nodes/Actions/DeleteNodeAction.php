<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Actions;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\Exceptions\ServiceClientException;
use AMRCFactoryPlus\UUIDs\App;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;
use function func_get_args;

class DeleteNodeAction
{

    /**
     * This action deletes an empty node and cleans up all connections for the node. It also removes all principals
     * and config store entries, effectively undoing the creation of the node.
     **/

    private function authorise(Node $node)
    {
        if (!auth()->user()->administrator && !auth()->user()->accessibleNodes->contains($node)) {
            throw new ActionForbiddenException('You do not have permission to delete this node.', 401);
        }
    }

    private function validate(Node $node)
    {
        // Check that the node has no devices
        if ($node->devices->count() > 0) {
            throw new ActionFailException('You cannot delete a node that has devices. Delete all devices from the node first and try again.');
        }
    }

    /**
     * @throws ActionForbiddenException
     * @throws ActionFailException
     * @throws ServiceClientException
     */
    public function execute(Node $node)
    {

        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();

        $configDB->deleteConfig(App::EdgeAgentDeployment, $node->uuid);
        $configDB->deleteConfig(App::SparkplugAddress, $node->uuid);

        /* XXX This should be a library method to mark an object deleted */
        $info = $configDB->getConfig(App::Info, $node->uuid);
        $info["deleted"] = true;
        $configDB->putConfig(App::Info, $node->uuid, $info);

        $node->delete();

        Log::info('Node deleted', ['node' => $node]);

        return action_success();


    }

}
