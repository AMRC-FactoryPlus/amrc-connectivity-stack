<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Console\Commands;

use App\Domain\Schemas\Actions\ImportSchemasFromStorageAction;
use Illuminate\Console\Command;

class ImportSchemasCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'schemas:import';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Synchronise all of the schemas in the Factory+ schema storage (MinIO) with the management application';

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
        (new ImportSchemasFromStorageAction)->execute();

        return 0;
    }
}
