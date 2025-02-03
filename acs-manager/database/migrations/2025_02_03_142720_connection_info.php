<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class ConnectionInfo extends Migration
{
    public function up()
    {
        Schema::table("nodes", function (Blueprint $table) {
            $table->text("hostname")->nullable();
        });
        Schema::table("device_connections", function (Blueprint $table) {
            $table->uuid("uuid")->nullable();
            $table->uuid("driver")->nullable();
            $table->json("deployment")->nullable();
        });
    }

    public function down()
    {
    }
}
