<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\FileService\Resources;

use Illuminate\Http\Resources\Json\ResourceCollection;
use OpenApi\Attributes as OA;

#[OA\Schema(
    schema: 'UploadFileForDeviceResourceCollection',
    required: ['status', 'data'],
    properties: [
        new OA\Property(property: 'status', type: 'string', example: 'success'),
        new OA\Property(
            property: 'data',
            required: ['data'],
            properties: [
                new OA\Property(
                    property: 'data',
                    type: 'array',
                    items: new OA\Items(
                        ref: '#/components/schemas/UploadFileForDeviceResource'
                    )
                ),
            ],
            type    : 'object',
        ),
    ]
)]
class UploadFileForDeviceResourceCollection extends ResourceCollection
{
    /**
     * Transform the resource collection into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        return $this->resource->toArray();
    }
}
