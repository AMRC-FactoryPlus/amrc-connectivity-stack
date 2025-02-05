<?php
/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

namespace App\Domain\Schemas\Actions;

use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Exceptions\ActionFailException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ImportSchemasFromStorageAction
{
    /**
     * This action imports all schemas from the MinIO instance.
     **/
    public function execute()
    {
        $cacheDuration = now()->addMinutes(15);

        foreach (
            HTTP::get('https://api.github.com/repos/AMRC-FactoryPlus/schemas/git/trees/main?recursive=1')
                ->json()['tree'] as $item
        ) {
            if (preg_match("/-v\d+.json$/", $item['path'])) {
                try {
                    (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/'.$item['path']);

                    $cacheKeyForFile = 'schema:'.$item['path'];

                    // Fetch schema from cache or API
                    Cache::remember($cacheKeyForFile, $cacheDuration, function () use ($item) {
                        return file_get_contents('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/'.$item['path']);
                    });
                } catch (ActionFailException $e) {
                    Log::error('Failed to import schema from '.$item['path']);
                }
            }
        }

        return action_success();
    }
}
