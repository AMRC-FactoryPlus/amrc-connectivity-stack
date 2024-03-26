<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Exceptions;

use App\Exceptions\ActionFailException;
use App\Exceptions\ReauthenticationRequiredException;
use App\Support\Traits\HandleActionExceptions;
use Exception;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    use HandleActionExceptions;

    /**
     * A list of the exception types that are not reported.
     *
     * @var array
     */
    protected $dontReport
        = [
            ActionFailException::class,
            ReauthenticationRequiredException::class,
        ];
    /**
     * A list of the inputs that are never flashed for validation exceptions.
     *
     * @var array
     */
    protected $dontFlash
        = [
            'password',
            'password_confirmation',
        ];

    /**
     * Report or log an exception.
     *
     *
     * @return void
     *
     * @throws Exception
     */
    public function report(Throwable $exception)
    {
        if (app()->bound('sentry') && $this->shouldReport($exception)) {
            app('sentry')->captureException($exception);
        }

        parent::report($exception);
    }

    /**
     * Render an exception into an HTTP response.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Symfony\Component\HttpFoundation\Response
     *
     * @throws Throwable
     */
    public function render($request, Throwable $exception)
    {
        return parent::render($request, $exception);
    }
}
