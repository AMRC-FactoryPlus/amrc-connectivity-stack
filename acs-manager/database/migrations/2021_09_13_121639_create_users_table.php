<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateUsersTable extends Migration
{
    public function up()
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->timestamps();
            $table->rememberToken();
            $table->string('username')->unique();
            $table->boolean('administrator')->default(0);
            $table->text('preferences')->nullable();
            $table->text('metadata')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('users');
    }
}
