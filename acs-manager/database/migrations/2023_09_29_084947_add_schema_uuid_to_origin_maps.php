<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Domain\Devices\Models\Device;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('origin_maps', function (Blueprint $table) {
            $table->string('schema_uuid')->nullable();
        });

        // Copy the schema_uuid from every device to the origin_map
        foreach (Device::with('originMaps')->get() as $device) {


            // Update the schema_uuid of every origin_map
            foreach ($device->originMaps as $originMap) {
                $originMap->schema_uuid = $device->schema_uuid;
                $originMap->save();
            }
        }

        Schema::table('devices', function (Blueprint $table) {
            $table->dropColumn('schema_uuid');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('origin_maps', function (Blueprint $table) {
            $table->dropColumn('schema_uuid');
        });

        Schema::table('devices', function (Blueprint $table) {
            $table->string('schema_uuid')->nullable();
        });
    }
};
