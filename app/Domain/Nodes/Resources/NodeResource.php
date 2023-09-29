<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class NodeResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        //        return parent::toArray($request);
        return [
            'id' => $this['id'],
            'node_id' => $this['node_id'],
            'uuid' => $this['uuid'],
            'is_valid' => $this['is_valid'],
            'expiry_date' => $this['expiry_date'],
            'group' => $this->whenLoaded('group'),
        ];
    }
}
