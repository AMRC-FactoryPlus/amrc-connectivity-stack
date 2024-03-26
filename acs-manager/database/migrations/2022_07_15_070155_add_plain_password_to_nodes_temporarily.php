<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddPlainPasswordToNodesTemporarily extends Migration
{
    public function up()
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->text('plain_password_delete')->nullable();
        });
    }

    public function down()
    {
        Schema::table('nodes_temporarily', function (Blueprint $table) {
            //
        });
    }
}
