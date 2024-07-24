<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\OriginMaps\Models;

use App\DeviceSchemaVersion;
use App\Domain\Devices\Models\Device;
use App\Support\Models\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class OriginMap extends Model
{

    protected $guarded = [];

    public function scopeActive($query)
    {
        return $query->whereActive(1);
    }

    public function scopeInactive($query)
    {
        return $query->whereActive(0);
    }

    public function device()
    {
        return $this->belongsTo(Device::class);
    }

    public function schemaVersion()
    {
        return $this->belongsTo(DeviceSchemaVersion::class, 'schema_uuid', 'schema_uuid');
    }
}
