<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Users\Resources;

    use Illuminate\Http\Resources\Json\JsonResource;

    class UserResource extends JsonResource
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
                'id' => $this['id'],
                'username' => $this['username'],
                'avatar' => $this['avatar'],

                $this->mergeWhen($this['id'] === auth()->id(), [
                    'first_name' => $this['first_name'],
                    'last_name' => $this['last_name'],
                ]),
            ];
        }
    }
