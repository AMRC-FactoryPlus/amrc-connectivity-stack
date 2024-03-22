<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateNodesTable extends Migration
{
    public function up()
    {
        Schema::create('nodes', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid');
            $table->dateTime('created_at')->nullable()->useCurrent();
            $table->dateTime('updated_at')->nullable()->useCurrent();
            $table->string('principal', 100)->unique();
            $table->string('node_id', 100)->nullable();
            $table->boolean('is_admin')->default(0);
            $table->boolean('is_valid');
            $table->date('expiry_date')->nullable();

            $table->foreignId('group_id')->index('nodes_FK_1');

            $table->unique(['group_id', 'node_id'], 'node_group_UN');
        });
    }

    public function down()
    {
        Schema::dropIfExists('nodes');
    }
}
