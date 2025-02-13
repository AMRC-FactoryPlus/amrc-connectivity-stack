<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2025 University of Sheffield AMRC
 */

namespace App\Console\Commands;

use App\Domain\DeviceConnections\Actions\RegisterConnections;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class RegisterConnectionsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'connections:register';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Register Connections in the ConfigDB';

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
        (new RegisterConnections)->execute();

        return 0;
    }
}
