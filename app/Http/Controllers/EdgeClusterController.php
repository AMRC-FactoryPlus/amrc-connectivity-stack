<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Clusters\Actions\GetClustersAction;
use App\Domain\EdgeClusters\Actions\GetEdgeClustersAction;
use Illuminate\Http\Request;

class EdgeClusterController extends Controller
{
    public function index()
    {
        return process_action((new GetEdgeClustersAction())->execute());
    }
}
