<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Clusters\Actions\GetClustersAction;

class ClusterController extends Controller
{
    public function index()
    {
        return process_action((new GetClustersAction)->execute());
    }
}
