<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Meta\Actions;

    class ResetMetaAction
    {
        public function execute($meta)
        {
            auth()->user()->resetMeta($meta);

            return action_success();
        }
    }
