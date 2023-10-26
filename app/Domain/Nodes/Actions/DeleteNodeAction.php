<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Actions;

use App\Domain\Helpers\Actions\BuildKerberosCRDNameAction;
use App\Domain\Helpers\Actions\BuildKerberosPrincipalAction;
use App\Domain\Nodes\CRDs\KerberosKey;
use App\Domain\Nodes\Models\Node;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;
use RenokiCo\LaravelK8s\KubernetesCluster;
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

    public function execute(Node $node)
    {

        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $isCellGateway = !is_null($node->k8s_hostname);
        if (!$isCellGateway) {
            $nodeHostname = 'soft';
        } else {
            $nodeHostname = $node->k8s_hostname;
        }

        // Get the K8s cluster
        if (in_array(config('app.env'), ['local', 'testing']) && env('K8S_DEPLOY_WHEN_LOCAL', false)) {
            ray('Using local K8s config file');
            $cluster = KubernetesCluster::fromKubeConfigYamlFile(env('LOCAL_KUBECONFIG'), 'default');
        } else {
            $cluster = KubernetesCluster::inClusterConfiguration();
        }

        $k8sSafeName = substr(str_replace('_', '-', (new BuildKerberosCRDNameAction())->execute($node->group, $nodeHostname, $node->node_id)['data']), 0, 60);
        $namespace = $node->group->cluster->namespace;
        $nodeUuid = $node->uuid;

        // Delete the KerberosKey
        try {
            KerberosKey::register('kk');
            $cluster->kk()->whereNamespace($namespace)->getByName($k8sSafeName)->delete();
        } catch (\Exception $e) {
            Log::warning('Failed to delete KerberosKey for node ' . $node->node_id . ' (' . $node->uuid . ')');
        }

        // Remove the Edge Agent
        try {
            $deploymentName = (!$isCellGateway ? '' : 'soft-') . 'edge-agent-' . $nodeUuid;
            $cluster->deployment()->whereNamespace($namespace)->getByName($deploymentName)->delete();
        } catch (\Exception $e) {
            Log::warning('Failed to delete deployment for node ' . $node->node_id . ' (' . $node->uuid . ')');
        }

        //-----------------|
        // Auth & ConfigDB |
        //-----------------|

        // It should be noted that no removals are made from the ConfigDB when deleting objects. This
        // is intentional so that UUIDS can be looked-up for traceability purposes and to ensure that
        // UUIDs are not reused.

        // Remove the entry in the Auth service that maps the Kerberos principal to the node UUID
        try {

            (new MakeConsumptionFrameworkRequest)->execute(type: 'delete', service: 'auth', url: config('manager.auth_service_url') . '/authz/principal/' . $nodeUuid,);
        } catch (\Exception $e) {
            Log::error('Failed to delete principal for node ' . $node->node_id . ' (' . $node->uuid . ')');
        }

        // Remove the ACL entry that allows the new node to participate as an Edge Node (87e4a5b7-9a89-4796-a216-39666a47b9d2)
        try {
            (new MakeConsumptionFrameworkRequest)->execute(type: 'post', service: 'auth', url: config('manager.auth_service_url') . '/authz/ace', payload: ['action' => 'delete', 'principal' => $nodeUuid, 'permission' => '87e4a5b7-9a89-4796-a216-39666a47b9d2', 'target' => $nodeUuid,]);
        } catch (\Exception $e) {
            Log::error('Failed to delete ACL entry for node ' . $node->node_id . ' (' . $node->uuid . ')');
        }

        // Delete the node and all connections
        $node->deviceConnections()->delete();
        $node->delete();

        Log::info('Node deleted', ['node' => $node]);

        return action_success();


    }

}
