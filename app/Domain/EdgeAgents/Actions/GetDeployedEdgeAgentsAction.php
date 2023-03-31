<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeAgents\Actions;

use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use RenokiCo\LaravelK8s\KubernetesCluster;

use function func_get_args;

class GetDeployedEdgeAgentsAction
{
    public function execute()
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        if (! in_array(config('app.env'), ['local', 'testing'])) {
            $cluster = KubernetesCluster::inClusterConfiguration();
        } elseif (env('LOCAL_KUBECONFIG')) {
            $cluster = KubernetesCluster::fromKubeConfigYamlFile(
                env('LOCAL_KUBECONFIG'),
                'default'
            );
        } else {
            throw new ActionFailException('No LOCAL_KUBECONFIG environment variable provided. One must be provided if running locally.');
        }

        $all = collect([]);

        if (config('manager.multi_cluster')) {
            foreach (explode(',', config('manager.clusters')) as $cluster) {
                $all = $all->merge($cluster->deployment()->whereNamespace('fplus' . $cluster . '-local')->all());
            }
        } else {
            $all = $all->merge($cluster->deployment()->whereNamespace(config('manager.namespace'))->all());
        }

        return action_success(
            $all->filter(function ($value) {
                $labels = $value->getLabels();

                return in_array('soft-edge-agent', $labels, true) || in_array(
                    'cell-edge-agent',
                    $labels,
                    true
                );
            })
        );
    }

    /**
     * This action gets all Edge Agents deployed across the cluster
     **/
    private function authorise()
    {
        if (! auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can manage Edge Agents.');
        }
    }

    private function validate()
    {
    }
}
