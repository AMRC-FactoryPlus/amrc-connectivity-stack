<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Console\Commands;

use Illuminate\Console\GeneratorCommand;
use Illuminate\Support\Str;

class GenerateActionResourceCollectionCommand extends GeneratorCommand
{
    protected $name = 'make:action-resource-collection';

    protected $signature = 'make:action-resource-collection {name} {domain}';

    protected $description = 'Create a new ResourceCollection class for an Action';

    protected $type = 'ResourceCollection';

    protected function getStub(): string
    {
        return __DIR__ . '/stubs/resource_collection.stub';
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

        // Strip the word Action from the end
        $name = preg_replace('/Action$/', '', $name);

        return base_path('app') . '/' . str_replace('\\', '/', $name) . 'ResourceCollection.php';
    }

    protected function getDefaultNamespace($rootNamespace): string
    {
        return $rootNamespace . '\Domain\\' . $this->argument('domain') . '\Resources';
    }

    /**
     * Build the class with the given name.
     *
     * @param  string  $name
     * @return string
     *
     * @throws \Illuminate\Contracts\Filesystem\FileNotFoundException
     */
    protected function buildClass($name)
    {
        $stub = $this->files->get($this->getStub());

        $name = preg_replace('/Action$/', '', $name);

        return $this->replaceNamespace($stub, $name)->replaceClass($stub, $name);
    }
}
