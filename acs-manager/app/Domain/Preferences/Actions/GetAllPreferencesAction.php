<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Preferences\Actions;

    class GetAllPreferencesAction
    {
        public function execute()
        {
            return action_success(auth()->user()->full_preferences);
        }
    }
