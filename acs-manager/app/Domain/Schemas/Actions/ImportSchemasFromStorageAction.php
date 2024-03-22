<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Schemas\Actions;

use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Exceptions\ActionFailException;
use Illuminate\Support\Facades\Http;

class ImportSchemasFromStorageAction
{
    /**
     * This action imports all schemas from the MinIO instance.
     **/
    public function execute()
    {
        foreach (
            HTTP::get('https://api.github.com/repos/AMRC-FactoryPlus/schemas/git/trees/main?recursive=1')
                ->json()['tree'] as $item
        ) {
            if (preg_match("/-v\d+.json$/", $item['path'])) {
                try {
                    (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/' . $item['path']);
                } catch (ActionFailException $e) {
                }
            }
        }

        return action_success();
    }
}
