<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Meta\Actions;

    class GetMetaAction
    {
        public function execute($meta)
        {
            return action_success(auth()->user()->meta($meta));
        }
    }
