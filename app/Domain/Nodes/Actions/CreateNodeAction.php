<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Actions;

use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\CRDs\KerberosKey;
use App\Domain\Nodes\Models\Node;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;
use App\Exceptions\ActionErrorException;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;
use RenokiCo\LaravelK8s\KubernetesCluster;
use RenokiCo\PhpK8s\Exceptions\KubernetesAPIException;

class CreateNodeAction
{
    /**
     * This action creates a node in the given group
     **/
    /*
     * Constraints:
     * - The user must be an admin
     */

    public function execute(
        Group $group,
              $nodeId,
              $isGateway = true,
              $enabled = true,
              $expiry = null,
              $nodeHostname = null
    )
    {
        // =========================
        // Validate User Permissions
        // =========================

        if (!auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can create new nodes.');
        }

        if ($isGateway && !$nodeHostname) {
            if (!$group->cluster->has_central_agents) {
                throw new ActionFailException('Soft Gateways can only be created in clusters with central agent nodes');
            }

            if (config('manager.multi_cluster')) {
                throw new ActionFailException('Deploying Soft Gateways on multi-cluster instances is not enabled.');
            }
        }

        if ($group->nodes()
            ->where('node_id', $nodeId)
            ->exists()) {
            throw new ActionFailException('This group already has a node with this name.');
        }

        // ===================
        // Perform the Action
        // ===================

        $isCellGateway = !is_null($nodeHostname);
        if (!$isCellGateway) {
            $nodeHostname = 'soft';
        }

        if ((bool)$isGateway === true) {
            $node = Node::create([
                'node_id' => $nodeId,
                'k8s_hostname' => $nodeHostname,
                'principal' => $this->getKerberosPrincipal($group, $nodeHostname, $nodeId),
                'expiry_date' => $expiry,
                'group_id' => $group->id,
                'is_admin' => 0,
                'is_valid' => $enabled,
            ]);
            $nodeUuid = $node->fresh()->uuid;
            $namespace = $group->cluster->namespace;

            // Create the secret and label the Cell Gateway node in the K8s cluster to pick it up
            if (!in_array(config('app.env'), ['local', 'testing']) || env('K8S_DEPLOY_WHEN_LOCAL', false)) {

                if (in_array(config('app.env'), ['local', 'testing']) && env('K8S_DEPLOY_WHEN_LOCAL', false)) {
                    ray('Using local K8s config file');
                    $cluster = KubernetesCluster::fromKubeConfigYamlFile(
                        env('LOCAL_KUBECONFIG'),
                        'default'
                    );
                } else {
                    $cluster = KubernetesCluster::inClusterConfiguration();
                }

                $k8sSafeName = substr(
                    str_replace('_', '-', $this->getKerberosKeyCRDName($group, $nodeHostname, $nodeId)),
                    0,
                    60
                );

                Log::debug('Creating kerberos key for edge agent', [
                    'type' => 'Password',
                    'principal' => $this->getKerberosPrincipal($group, $nodeHostname, $nodeId),
                    'secret' => 'edge-agent-secrets-' . $nodeUuid . '/keytab',
                ]);

                $spec = [
                    'name' => $k8sSafeName,
                    'type' => 'Password',
                    'principal' => $this->getKerberosPrincipal($group, $nodeHostname, $nodeId),
                    'secret' => 'edge-agent-secrets-' . $nodeUuid . '/keytab',
                ];

                // If we're sending this to another cluster then we need to seal the KerberosKey with the kubeseal cert of the remote cluster
                // This assumes that there is a ConfigMap called kubeseal-cert/cert containing the certificate in the same namespace
                if (config('manager.multi_cluster')) {
                    $spec['sealWith'] = 'kubeseal-cert/cert';
                }

                // Create a password for the edge agent to use to connect to the MQTT server and store it in the secret
                (new KerberosKey($cluster, [
                    'spec' => $spec,
                ]))->setName($k8sSafeName)
                    ->setNamespace($namespace)
                    ->setLabels([
                        'app.kubernetes.io/managed-by' => 'management-app',
                        'type' => 'edge-agent-secrets',
                        'nodeName' => $nodeId,
                        'groupName' => $group->name,
                        'nodeUuid' => $nodeUuid,
                        'nodeHostname' => $nodeHostname,
                    ])
                    ->create();

                // Deploy the edge agent
                if ($isCellGateway) {
                    $template = config(
                        'manager.multi_cluster'
                    ) ? 'remote-edge-agent-template.yaml' : 'edge-agent-template.yaml';
                } else {
                    $template = config(
                        'manager.multi_cluster'
                    ) ? 'remote-soft-edge-agent-template.yaml' : 'soft-edge-agent-template.yaml';
                }

                $resources = $cluster->fromTemplatedYamlFile(app_path('/Domain/Nodes/YAML/' . $template), [
                    'name' => $k8sSafeName,
                    'hostname' => $nodeHostname,
                    'nodeUuid' => $nodeUuid,
                    'namespace' => $namespace,
                    'appUrl' => config('manager.management_app_from_edge'),
                    'registry' => config('manager.new_edge_agents.registry'),
                    'repository' => config('manager.new_edge_agents.repository'),
                    'version' => config('manager.new_edge_agents.version'),
                    'debug' => config('manager.new_edge_agents.debug'),
                    'pollInterval' => config('manager.new_edge_agents.pollInterval'),
                ]);

                try {
                    $resources->createOrUpdate();
                } catch (KubernetesAPIException $e) {
                    throw new ActionErrorException($e->getPayload()['message']);
                }

                //-----------------|
                // Auth & ConfigDB |
                //-----------------|
                /**
                 * Add the required entries into the Auth & ConfigDB services. To do this we need to effectively "Login" to the services as the
                 * management app
                 **/

                // Create an entry in the ConfigDB to describe this node using the Cell gateway (00da3c0b-f62b-4761-a689-39ad0c33f864)
                // or Soft gateway (5bee4d24-32e1-44f8-b953-1f86ff4b3e87) class
                (new MakeConsumptionFrameworkRequest)->execute(
                    type: 'post',
                    service: 'configdb',
                    url: config('manager.configdb_service_url') . '/v1/object',
                    payload: [
                        'uuid' => $nodeUuid,
                        'class' => $isCellGateway ? '00da3c0b-f62b-4761-a689-39ad0c33f864' : '5bee4d24-32e1-44f8-b953-1f86ff4b3e87',
                    ]
                );

                // Create entry in the ConfigDB for the General object information Application (64a8bfa9-7772-45c4-9d1a-9e6290690957)
                (new MakeConsumptionFrameworkRequest)->execute(
                    type: 'put',
                    service: 'configdb',
                    url: config(
                        'manager.configdb_service_url'
                    ) . '/v1/app/64a8bfa9-7772-45c4-9d1a-9e6290690957/object/' . $nodeUuid,
                    payload: [
                        'name' => $group->name . '-' . $node->node_id,
                    ]
                );

                // Create entry in the ConfigDB for the Sparkplug address information (8e32801b-f35a-4cbf-a5c3-2af64d3debd7) Application
                (new MakeConsumptionFrameworkRequest)->execute(
                    type: 'put',
                    service: 'configdb',
                    url: config(
                        'manager.configdb_service_url'
                    ) . '/v1/app/8e32801b-f35a-4cbf-a5c3-2af64d3debd7/object/' . $nodeUuid,
                    payload: [
                        'node_id' => $nodeId,
                        'group_id' => $group->name,
                    ]
                );

                // Create entry in the Auth service to map the Kerberos principal to the node UUID
                (new MakeConsumptionFrameworkRequest)->execute(
                    type: 'post',
                    service: 'auth',
                    url: config('manager.auth_service_url') . '/authz/principal',
                    payload: [
                        'uuid' => $nodeUuid,
                        'kerberos' => $this->getKerberosPrincipal($group, $nodeHostname, $nodeId),
                    ]
                );

                // Create an ACL entry to allow the new node to participate as an Edge Node (87e4a5b7-9a89-4796-a216-39666a47b9d2)
                (new MakeConsumptionFrameworkRequest)->execute(
                    type: 'post',
                    service: 'auth',
                    url: config('manager.auth_service_url') . '/authz/ace',
                    payload: [
                        'action' => 'add',
                        'principal' => $nodeUuid,
                        'permission' => '87e4a5b7-9a89-4796-a216-39666a47b9d2',
                        'target' => $nodeUuid,
                    ]
                );
            }

            return action_success([
                'node' => [
                    'node_id' => $node->node_id,
                    'uuid' => $node->uuid,
                    'id' => $node->id,
                ],
            ]);
        }

        $node = Node::create([
            'node_id' => $nodeId,
            'principal' => $this->getKerberosPrincipal($group, $nodeHostname, $nodeId),
            'expiry_date' => $expiry,
            'group_id' => $group->id,
            'is_admin' => 0,
            'is_valid' => $enabled,
        ]);

        $node = Node::whereId($node->id)
            ->sole();

        return action_success([
            'node' => [
                'node_id' => $node->node_id,
                'uuid' => $node->uuid,
                'id' => $node->id,
            ],
        ]);
    }

    public function getKerberosKeyCRDName($group, $hostname, $nodeId)
    {
        // Convert the GroupName to lowercase

        $prefix = 'sg' . $group->cluster->id;
        // If we have a hostname then this is a Cell Gateway
        if ($hostname) {
            $prefix = 'nd' . $group->cluster->id;
        }

        return $prefix . '-' . strtolower($group->name) . '-' . strtolower($nodeId);
    }

    public function getKerberosPrincipal($group, $hostname, $nodeId)
    {
        return $this->getKerberosKeyCRDName($group, $hostname, $nodeId) . '@' . config('manager.domain');
    }
}
