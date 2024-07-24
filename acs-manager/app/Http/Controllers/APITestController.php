<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use Exception;

class APITestController extends Controller
{
    public function fail()
    {
        throw new \App\Exceptions\ActionFailException('You can not run this action.');
    }

    public function error()
    {
        throw new \App\Exceptions\ActionErrorException('You can not run this action.');
    }

    public function other()
    {
        throw new Exception('Other message that should not be seen in production.');
    }
}
