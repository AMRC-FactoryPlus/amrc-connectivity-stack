<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Meta\Actions;

    class SetMetaAction
    {
        public function execute($revisions)
        {
            auth()->user()->setMeta($revisions);

            return action_success();
        }
    }
