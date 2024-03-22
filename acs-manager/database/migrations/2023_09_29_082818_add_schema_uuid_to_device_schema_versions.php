<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('device_schema_versions', function (Blueprint $table) {
            $table->string('schema_uuid')->nullable();
        });

        Artisan::call('schemas:import');
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('device_schema_versions', function (Blueprint $table) {
            $table->dropColumn('schema_uuid');
        });
    }
};
