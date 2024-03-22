<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateNodeUserTable extends Migration
{
    public function up()
    {
        Schema::create('node_user', function (Blueprint $table) {
            $table->id();
            $table->timestamps();

            $table->foreignId('user_id');
            $table->foreignId('node_id');
        });
    }

    public function down()
    {
        Schema::dropIfExists('node_user');
    }
}
