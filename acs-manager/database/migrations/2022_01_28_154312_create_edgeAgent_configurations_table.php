<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateEdgeAgentConfigurationsTable extends Migration
{
    public function up()
    {
        Schema::create('edge_agent_configurations', function (Blueprint $table) {
            $table->id();
            $table->timestamps();
            $table->foreignId('node_id');
            $table->string('file');
        });
    }

    public function down()
    {
        Schema::dropIfExists('edge_agent_configurations');
    }
}
