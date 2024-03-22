<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Auth\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class GetAuthServiceTokenResource extends JsonResource
{
    public function toArray($request)
    {
        return [];
    }
}
