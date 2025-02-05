<?php
/*
 * Copyright (c) University of Sheffield AMRC 2025.
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
