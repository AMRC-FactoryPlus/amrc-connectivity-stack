<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Preferences\Actions;

    class GetPreferenceAction
    {
        public function execute(string $preference)
        {
            return action_success(auth()->user()->preference($preference));
        }
    }
