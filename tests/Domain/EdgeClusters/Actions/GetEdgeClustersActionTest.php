<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\EdgeClusters\Actions;

use App\Domain\EdgeClusters\Actions\GetEdgeClustersAction;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;
use Tests\TestCase;

class GetEdgeClustersActionTest extends TestCase
{
    public function test_that_it_gets_the_edge_clusters(){

        $this->signInAdmin();

        (new GetEdgeClustersAction())->execute()['data'];
    }
}
