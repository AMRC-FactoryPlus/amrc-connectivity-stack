<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateOriginMapsTable extends Migration
{
    public function up()
    {
        Schema::create('origin_maps', function (Blueprint $table) {
            $table->id();
            $table->timestamps();

            $table->foreignId('device_id');
            $table->foreignId('device_schema_version_id');

            $table->string('name');
            $table->string('file');
            $table->string('metrics');
            $table->boolean('active')->default(false);
        });
    }

    public function down()
    {
        Schema::dropIfExists('origin_maps');
    }
}
