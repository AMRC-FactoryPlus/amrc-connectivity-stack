<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Models;

use App\DeviceConnection;
use App\Domain\Nodes\Models\Node;
use App\Domain\OriginMaps\Models\OriginMap;
use App\Support\Models\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Laravel\Scout\Searchable;

class Device extends Model
{
    use Searchable;

    protected $guarded = [];

    public function toSearchableArray()
    {
        return $this->only(['id', 'device_id']);
    }

    public function node()
    {
        return $this->belongsTo(Node::class);
    }

    public function activeOriginMap()
    {
        return $this->hasOne(OriginMap::class)->active()->latestOfMany();
    }

    public function latestOriginMap()
    {
        return $this->hasOne(OriginMap::class)->latestOfMany();
    }

    public function originMaps()
    {
        return $this->hasMany(OriginMap::class);
    }

    public function deviceConnection()
    {
        return $this->belongsTo(DeviceConnection::class);
    }
}
