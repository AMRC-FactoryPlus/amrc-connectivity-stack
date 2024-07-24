<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddK8sHostnameToNodes extends Migration
{
    public function up()
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->string('k8s_hostname')->nullable();
        });
    }

    public function down()
    {
        Schema::table('nodes', function (Blueprint $table) {
            //
        });
    }
}
