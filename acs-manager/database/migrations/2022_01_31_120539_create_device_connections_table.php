<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateDeviceConnectionsTable extends Migration
{
    public function up()
    {
        Schema::create('device_connections', function (Blueprint $table) {
            $table->id();
            $table->timestamps();

            $table->foreignId('node_id');

            $table->string('name');
            $table->string('file')->nullable();
            $table->boolean('active')->default(false);
        });
    }

    public function down()
    {
        Schema::dropIfExists('device_connections');
    }
}
