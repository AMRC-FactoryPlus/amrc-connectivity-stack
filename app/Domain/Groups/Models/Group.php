<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Groups\Models;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Nodes\Models\Node;
use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;

class Group extends Model
{
    use Searchable;

    public $timestamps = false;

    protected $table = 'groups';
    protected $guarded = [];

    public function toSearchableArray()
    {
        return $this->only(['id', 'name']);
    }

    public function nodes()
    {
        return $this->hasMany(Node::class);
    }
}
