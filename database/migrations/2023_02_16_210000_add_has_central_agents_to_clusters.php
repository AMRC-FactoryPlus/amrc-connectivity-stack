<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Domain\Clusters\Models\Cluster;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddHasCentralAgentsToClusters extends Migration
{
    public function up()
    {
        Schema::table('clusters', function (Blueprint $table) {
            $table->boolean('has_central_agents')->default(0);
        });

        if (Cluster::count() === 1) {
            Cluster::first()->update([
                'has_central_agents' => 1,
            ]);
        }
    }

    public function down()
    {
        Schema::table('clusters', function (Blueprint $table) {
            //
        });
    }
}
