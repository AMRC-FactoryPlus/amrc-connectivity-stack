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

class UpdateEdgeAgentVersionAction
{
    public function execute(string $name, string $namespace, string $version)
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

        $resource = $cluster->deployment()->whereNamespace($namespace)->setName($name)->get();

        $existingImage = $resource->getSpec('template.spec.containers.0.image');
        $strippedImage = substr($existingImage, 0, strrpos($existingImage, ':') + 1);

        $resource->setSpec('template.spec.containers.0.image', $strippedImage . $version)->update();

        return action_success();
    }

    /**
     * This action patches the edge agent deployment for the supplied uid and updates it with the
     * supplied edge agent version
     **/
    private function authorise()
    {
        if (! auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can update edge agent versions.');
        }
    }

    private function validate()
    {
    }
}
