<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Models;

use App\DeviceConnection;
use App\Domain\Devices\Models\Device;
use App\Domain\Users\Models\User;
use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;

class Node extends Model
{
    use Searchable;

    protected $table = 'nodes';
    protected $hidden = ['username', 'password_hash'];

    protected $guarded = [];

    public function toSearchableArray()
    {
        return $this->only(['id', 'node_id']);
    }

    public function accessibleBy()
    {
        return $this->belongsToMany(User::class);
    }

    public function devices()
    {
        return $this->hasMany(Device::class);
    }

    public function deviceConnections()
    {
        return $this->hasMany(DeviceConnection::class);
    }
}
