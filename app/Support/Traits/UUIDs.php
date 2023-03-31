<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Traits;

use Illuminate\Support\Str;

trait UUIDs
{
    /**
     * Boot function from Laravel.
     */
    protected static function boot()
    {
        parent::boot();
        static::creating(
            function ($model) {
                $model->uuid = Str::orderedUuid()->toString();
            }
        );
    }
}
