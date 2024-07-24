<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateSchemasTable extends Migration
{
    public function up()
    {
        Schema::create('schemas', function (Blueprint $table) {
            $table->id();
            $table->timestamps();

            $table->foreignId('schema_type_id');
            $table->text('version');
            $table->text('file');
        });
    }

    public function down()
    {
        Schema::dropIfExists('schemas');
    }
}
