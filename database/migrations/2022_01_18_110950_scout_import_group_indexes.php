<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Domain\Groups\Models\Group;
use Illuminate\Database\Migrations\Migration;

class ScoutImportGroupIndexes extends Migration
{
    public function up()
    {
        Artisan::call('scout:import', ['model' => Group::class]);
    }

    public function down()
    {
        //
    }
}
