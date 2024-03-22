<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddClusterToGroups extends Migration
{
    public function up()
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->foreignId('cluster_id');
        });
    }

    public function down()
    {
        Schema::table('groups', function (Blueprint $table) {
                //
        });
    }
}
