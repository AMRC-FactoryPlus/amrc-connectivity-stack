<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App;

use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Support\Models\Model;

class DeviceConnection extends Model
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

    public function node()
    {
        return $this->belongsTo(Node::class);
    }

    public function devices()
    {
        return $this->hasMany(Device::class);
    }
}
