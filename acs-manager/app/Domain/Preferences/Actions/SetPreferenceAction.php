<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Preferences\Actions;

    class SetPreferenceAction
    {
        public function execute(array $revisions)
        {
            auth()->user()->setPreference($revisions);

            return action_success();
        }
    }
