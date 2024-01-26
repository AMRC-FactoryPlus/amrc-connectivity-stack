<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Traits;

use App\Exceptions\ActionErrorException;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use App\Exceptions\ReauthenticationRequiredException;
use Exception;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * @mixin \Illuminate\Foundation\Exceptions\Handler
 */
trait HandleActionExceptions
{
    public function isActionException(Throwable $e)
    {
        return $e instanceof ActionFailException || $e instanceof ActionErrorException || $e instanceof ActionForbiddenException;
    }

    /**
     * Convert a validation exception into a JSON response.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Contracts\Routing\ResponseFactory|\Symfony\Component\HttpFoundation\Response
     */
    protected function invalidJson($request, ValidationException $exception)
    {
        return jsend_fail(
            $exception->errors(),
            $exception->status
        );
    }

    /**
     * Prepare a JSON response for the given exception.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  Exception  $e
     * @return \Illuminate\Contracts\Routing\ResponseFactory|\Symfony\Component\HttpFoundation\Response
     */
    protected function prepareJsonResponse($request, Throwable $e)
    {
        $message = $e->getMessage();

        // If the exception is a ReauthenticationRequiredException then send a special response that the UI can use
        // to show an inline login dialog
        if ($e instanceof ReauthenticationRequiredException) {
            return jsend_error(
                $message,
                $e->getStatusCode(),
                [
                    'reauthenticate' => true,
                ]
            );
        }

        $data = config('app.debug') ? [
            'exception' => get_class($e),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => collect($e->getTrace())->map(function ($trace) {
                return Arr::except($trace, ['args']);
            })->all(),
        ] : null;

        return jsend_error(
            ($this->isHttpException($e) || $this->isActionException($e) || config('app.debug')) ? $message : 'Server Error',
            $e->getCode(),
            $data,
            ($this->isHttpException($e) || $this->isActionException($e)) ? $e->getStatusCode() : 500,
            $this->isHttpException($e) ? $e->getHeaders() : []
        );
    }
}
