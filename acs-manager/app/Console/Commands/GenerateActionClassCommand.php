<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Console\Commands;

use Illuminate\Console\GeneratorCommand;

class GenerateActionClassCommand extends GeneratorCommand
{
    protected $name = 'make:action-class';

    protected $signature = 'make:action-class {name} {domain}';

    protected $description = 'Create a new action class';

    protected $type = 'Action';

    protected function getStub(): string
    {
        return __DIR__ . '/stubs/action.stub';
    }

    protected function getDefaultNamespace($rootNamespace): string
    {
        return $rootNamespace . '\Domain\\' . $this->argument('domain') . '\Actions';
    }
}
