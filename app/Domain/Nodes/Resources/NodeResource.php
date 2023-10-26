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
     * @param \Illuminate\Http\Request $request
     * @return array
     */
    public function toArray($request)
    {
        //        return parent::toArray($request);
        $res = [
            'id' => $this['id'],
            'node_id' => $this['node_id'],
            'uuid' => $this['uuid'],
            'is_valid' => $this['is_valid'],
            'expiry_date' => null,
            'group' => $this->whenLoaded('group'),
        ];

        if (auth()->user()->administrator) {
            $res['accessible_by'] = $this->accessibleBy->map(function ($item) {
                return $item->username;
            });
        }

        return $res;
    }
}
