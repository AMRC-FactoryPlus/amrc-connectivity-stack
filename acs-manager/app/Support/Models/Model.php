<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Models;

use App\Exceptions\LazyLoadingNotAllowedException;
use Illuminate\Database\Eloquent\Model as Eloquent;

/**
 * This model prevents eager loading as per "Lesson 22 - Making N+1 issues impossible" of "Eloquent Performance
 * Patterns"
 */
class Model extends Eloquent
{
    public function getRelationshipFromMethod($name)
    {
        $class = get_class($this);
        throw new LazyLoadingNotAllowedException("Lazy-loading relationships is not allowed ({$class}::{$name}).");
    }
}
