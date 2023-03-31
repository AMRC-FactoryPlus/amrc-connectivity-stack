<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Domain\Clusters\Models\Cluster;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up()
    {
        if (config('manager.multi_cluster')) {
            foreach (explode(',', config('manager.clusters')) as $cluster) {
                Cluster::create(
                    [
                        'name' => $cluster,
                        'namespace' => 'fplus-' . strtolower($cluster) . '-local',
                    ]
                );
            }
        } else {
            Cluster::create(
                [
                    'name' => config('manager.organisation'),
                    'namespace' => config('manager.namespace'),
                ]
            );
        }
    }

    public function down()
    {
        //
    }
};
