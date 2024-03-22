<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class GenerateActionCommand extends Command
{
    protected $name = 'make:action';

    protected $signature = 'make:action {name} {domain}';

    protected $description = 'Create a new action class and test';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $name = $this->argument('name');
        $actionDomain = $this->argument('domain');

        Artisan::call('make:action-class', [
            'name' => $name,
            'domain' => $actionDomain,
        ]);

        Artisan::call('make:action-test', [
            'name' => $name,
            'domain' => $actionDomain,
        ]);

        Artisan::call('make:action-resource', [
            'name' => $name,
            'domain' => $actionDomain,
        ]);

        Artisan::call('make:action-resource-collection', [
            'name' => $name,
            'domain' => $actionDomain,
        ]);
    }
}
