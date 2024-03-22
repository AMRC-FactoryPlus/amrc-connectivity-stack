<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateDevicesTable extends Migration
{
    public function up()
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->timestamps();

            // Node
            $table->foreignId('node_id');

            // Device
            $table->string('device_id')->nullable();
            $table->string('instance_uuid')->nullable();
            $table->string('schema_uuid')->nullable();

            // Connection
            $table->foreignId('device_connection_id')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('devices');
    }
}
