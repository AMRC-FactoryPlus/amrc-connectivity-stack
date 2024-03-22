<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Domain\OriginMaps\Models\OriginMap;
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
        foreach (OriginMap::all() as $originMap) {
            $schemaUUID = json_decode(Storage::disk('device-configurations')->get($originMap->file))?->Schema_UUID;
            if ($schemaUUID) {
                $originMap->schema_uuid = $schemaUUID;
                $originMap->save();
            }
        }
        
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {

    }
};
