<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Exceptions;

use Exception;

class ReauthenticationRequiredException extends Exception
{
    public $statusCode;

    public function __construct(string $message, int $statusCode = 401)
    {
        $this->statusCode = $statusCode;

        parent::__construct($message, $statusCode);
    }

    public function getStatusCode()
    {
        return $this->statusCode;
    }
}
