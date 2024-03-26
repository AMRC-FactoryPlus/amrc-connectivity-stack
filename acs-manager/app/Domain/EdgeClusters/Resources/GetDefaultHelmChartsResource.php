<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class GetDefaultHelmChartsResource extends JsonResource
{
    public function toArray($request)
    {
        return [];
    }
}
