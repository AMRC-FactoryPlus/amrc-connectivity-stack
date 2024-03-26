<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\EdgeClusters\Actions\GetDefaultHelmChartsAction;
use App\Domain\EdgeClusters\Actions\GetHelmChartsAction;

class HelmChartController extends Controller
{
    public function index()
    {
        return process_action((new GetHelmChartsAction())->execute());
    }

    public function defaults()
    {
        return process_action((new GetDefaultHelmChartsAction())->execute());
    }
}
