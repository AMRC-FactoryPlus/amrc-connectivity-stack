<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Support\Actions;

use Illuminate\Support\Facades\Http;

use function func_get_args;

class GetJsonFromGithubAction
{
    public function execute(string $path)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        return action_success(HTTP::get('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/' . $path)
                                  ->json());
    }

    /**
     * This action gets JSON from the Schemas repository and returns it to the browser to avoid CORS issues
     **/
    private function authorise()
    {
    }

    private function validate()
    {
    }
}
