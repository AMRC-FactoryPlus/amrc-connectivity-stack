<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Preferences\Actions;

    class ResetPreferenceAction
    {
        public function execute(string $preference)
        {
            auth()->user()->resetPreference($preference);

            return action_success();
        }
    }
