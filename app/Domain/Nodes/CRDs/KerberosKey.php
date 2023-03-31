<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\CRDs;

use RenokiCo\PhpK8s\Contracts\InteractsWithK8sCluster;
use RenokiCo\PhpK8s\Kinds\K8sResource;

class KerberosKey extends K8sResource implements InteractsWithK8sCluster
{
    /**
     * The resource Kind parameter.
     *
     * @var null|string
     */
    protected static $kind = 'KerberosKey';

    /**
     * The default version for the resource.
     *
     * @var string
     */
    protected static $defaultVersion = 'factoryplus.app.amrc.co.uk/v1';
    /**
     * Whether the resource has a namespace.
     *
     * @var bool
     */
    protected static $namespaceable = true;

    public static function getPlural()
    {
        return 'kerberos-keys';
    }
}
