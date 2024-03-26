<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App;

use App\Support\Models\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Laravel\Scout\Searchable;

class DeviceSchemaVersion extends Model
{
    use Searchable;

    protected $guarded = [];

    public function toSearchableArray()
    {
        return $this->only(['id', 'version', 'device_schema_id']);
    }

    public function schema()
    {
        return $this->belongsTo(DeviceSchema::class, 'device_schema_id');
    }
}
