<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Resources;

use App\Domain\Nodes\Resources\NodeResource;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class DeviceDetailResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        return [
            'created_at' => $this['created_at'],
            'updated_at' => $this['updated_at'],
            'id' => $this['id'],
            'instance_uuid' => $this['instance_uuid'] ?? null,
            'schema_uuid' => $this['schema_uuid'] ?? null,
            'node_id' => $this['node_id'],
            'device_id' => $this['device_id'],
            'device_connection_id' => $this['device_connection_id'],
            'node' => new NodeResource($this->whenLoaded('node')),
            'origin_maps' => $this->originMaps,
            'active_origin_map' => $this->activeOriginMap,
            'latest_origin_map' => $this->latestOriginMap,
            'model' => $this->latestOriginMap ? json_decode(
                Storage::disk('device-configurations')->get($this->latestOriginMap->file),
                false,
                512,
                JSON_THROW_ON_ERROR
            ) : null,
            'metrics' => $this->latestOriginMap ? json_decode(
                Storage::disk('device-configurations')->get($this->latestOriginMap->metrics),
                false,
                512,
                JSON_THROW_ON_ERROR
            ) : null,
            'device_connection' => $this->deviceConnection,
        ];
    }
}
