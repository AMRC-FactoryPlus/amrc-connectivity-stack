<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddAsyncAndCompressFlagsToNodes extends Migration
{
    public function up()
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->boolean('async_publish')->default(true);
            $table->boolean('compress_payloads')->default(false);
        });
    }

    public function down()
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropColumn('async_publish');
            $table->dropColumn('compress_payloads');
        });
    }
}
