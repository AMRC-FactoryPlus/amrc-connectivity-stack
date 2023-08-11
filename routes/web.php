<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\EdgeAgentController;
use App\Http\Controllers\SchemaEditorController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
|
| These routes are public to all.
|
*/

/*
|--------------------------------------------------------------------------
| Signed In
|--------------------------------------------------------------------------
|
| All routes below here require a user to be signed in.
|
*/

Route::group(
    [
        'middleware' => [
            'auth',
        ],
    ],
    static function () {
        Route::get('/', [DashboardController::class, 'nodes']);
        Route::get('edge-agents', [EdgeAgentController::class, 'index']);
        Route::get('schema-editor', [SchemaEditorController::class, 'index']);
        Route::get('preferences', [DashboardController::class, 'preferences']);
        Route::get('roles', [DashboardController::class, 'roles']);
        Route::get('users', [DashboardController::class, 'users']);
        Route::get('groups/{group}/nodes/{node}/devices/{device}', [DeviceController::class, 'show']);
    }
);
