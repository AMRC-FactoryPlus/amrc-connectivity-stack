<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Console\Commands;

use Illuminate\Console\GeneratorCommand;
use Illuminate\Support\Str;

class GenerateActionTestCommand extends GeneratorCommand
{
    protected $name = 'make:action-test';

    protected $signature = 'make:action-test {name} {domain}';

    protected $description = 'Create a new action class';

    protected $type = 'Test';

    protected function getStub(): string
    {
        return __DIR__ . '/stubs/action_test.stub';
    }

    /**
     * Get the destination class path.
     *
     * @param  string  $name
     * @return string
     */
    protected function getPath($name)
    {
        $name = Str::replaceFirst($this->rootNamespace(), '', $name);

        return base_path('tests') . str_replace('\\', '/', $name) . 'Test.php';
    }

    /**
     * Get the default namespace for the class.
     *
     * @param  string  $rootNamespace
     * @return string
     */
    protected function getDefaultNamespace($rootNamespace)
    {
        return $rootNamespace . '\Domain\\' . $this->argument('domain') . '\Actions';
    }

    /**
     * Get the root namespace for the class.
     *
     * @return string
     */
    protected function rootNamespace()
    {
        return 'Tests';
    }
}
