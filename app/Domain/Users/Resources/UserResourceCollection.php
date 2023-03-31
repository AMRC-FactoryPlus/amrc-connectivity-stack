<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Users\Resources;

    use Illuminate\Http\Resources\Json\ResourceCollection;

    class UserResourceCollection extends ResourceCollection
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
