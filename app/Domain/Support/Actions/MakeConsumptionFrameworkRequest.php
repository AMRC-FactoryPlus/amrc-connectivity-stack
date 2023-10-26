<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Support\Actions;

use App\Domain\Auth\Actions\GetServiceTokenAction;
use App\Exceptions\ActionErrorException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

use function func_get_args;

class MakeConsumptionFrameworkRequest
{
    public function execute(string $type, string $service, string $url, $payload = null, $file = null)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        // Try the request with the cached token for the service
        $response = $this->do($type, $service, $url, $payload, $file, false);

        // If response failed because of an expired bearer token then get a new one
        if ($response->unauthorized()) {
            Log::debug('Refreshing token for ' . $service . ' after failed auth.');
            $response = $this->do($type, $service, $url, $payload, $file, true);
        }

        if ($response->failed()) {
            throw new ActionErrorException('Failed to communicate with ' . $service . '. Status: ' . $response->status() . '.');
        }

        return action_success($response);
    }

    public function do(string $type, string $service, string $url, $payload = null, $file = null, $force = false)
    {
        $base = Http::withToken((new GetServiceTokenAction)->execute($service, $force)['data']);

        if ($file) {
            $base = $base->attach('file', fopen($file->getRealPath(), 'r'), $file->getClientOriginalName(), [
                'Content-Type' => $file->getClientMimeType(),
            ])->asMultipart();
        }

        return $base->$type($url, $payload);
    }

    /**
     * This action
     **/
    private function authorise(string $type, string $service, string $url, $payload = null, $file = null)
    {
    }

    private function validate(string $type, string $service, string $url, $payload = null, $file = null)
    {
        if (! in_array($type, ['get', 'post', 'put', 'delete'])) {
            throw new ActionErrorException('Incorrect method passed to MakeConsumptionFrameworkRequest');
        }
    }
}
