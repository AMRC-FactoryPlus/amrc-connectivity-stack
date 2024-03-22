<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateDeviceSchemaVersionsTable extends Migration
{
    public function up()
    {
        Schema::create('device_schema_versions', function (Blueprint $table) {
            $table->id();
            $table->timestamps();
            $table->foreignId('device_schema_id');
            $table->string('version');
        });
    }

    public function down()
    {
        Schema::dropIfExists('device_schema_versions');
    }
}
