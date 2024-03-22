<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App;

use App\Support\Models\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Laravel\Scout\Searchable;

class DeviceSchema extends Model
{
    use Searchable;

    protected $guarded = [];

    public function toSearchableArray()
    {
        return $this->only(['id', 'name', 'url']);
    }

    public function versions()
    {
        return $this->hasMany(DeviceSchemaVersion::class);
    }
}
