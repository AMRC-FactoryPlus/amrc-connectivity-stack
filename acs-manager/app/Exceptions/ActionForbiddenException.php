<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Exceptions;

use Exception;
use Illuminate\Support\Facades\Log;

class ActionForbiddenException extends Exception
{
    public int $statusCode;

    public function __construct(string $message)
    {
        if (config('app.env') !== 'testing') {
            Log::error('[ActionForbiddenException][' . (auth()->check() ? auth()->user()->username : 'Unauthenticated') . '] ' . $message, [
                'statusCode' => 403,
                'message' => $message,
                'stack_trace' => $this->getTraceAsString(),
            ]);
        }
        $this->statusCode = 403;

        parent::__construct($message, 403);
    }

    public function getStatusCode()
    {
        return $this->statusCode;
    }
}
