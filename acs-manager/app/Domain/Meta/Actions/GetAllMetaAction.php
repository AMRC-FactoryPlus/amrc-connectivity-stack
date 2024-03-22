<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Meta\Actions;

    class GetAllMetaAction
    {
        public function execute()
        {
            return action_success(auth()->user()->full_meta);
        }
    }
