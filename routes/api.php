<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Http\Controllers\APITestController;
use App\Http\Controllers\ClusterController;
use App\Http\Controllers\DeviceConnectionController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\DeviceFileController;
use App\Http\Controllers\DeviceSchemaController;
use App\Http\Controllers\DeviceSchemaVersionController;
use App\Http\Controllers\EdgeAgentConfigurationController;
use App\Http\Controllers\EdgeAgentController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\NodeController;
use App\Http\Controllers\NodeUserController;
use App\Http\Controllers\OriginMapController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\UserMetaController;
use App\Http\Controllers\UserPreferenceController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/


// ------ Testing ------ //
if (env('APP_ENV', 'local') !== 'production') {
    Route::post('testing/exception_fail', [APITestController::class, 'fail']);
    Route::post('testing/exception_error', [APITestController::class, 'error']);
    Route::post('testing/exception_other', [APITestController::class, 'other']);
}

// ------ Proxy ------ //
Route::middleware('auth:api')->post('/github-proxy', [\App\Http\Controllers\GithubProxyController::class, 'get']);

// ------ User ------ //
Route::middleware('auth:api')->patch('/user', [UserPreferenceController::class, 'update'])->name('user.update');

// ------ Preferences ------ //
Route::middleware('auth:api')->post('/user/set-preference', [UserPreferenceController::class, 'setPreference'])->name('preference.set');
Route::middleware('auth:api')->post('/user/reset-preference', [UserPreferenceController::class, 'resetPreference'])->name('preference.reset');
Route::middleware('auth:api')->post('/user/get-preference', [UserPreferenceController::class, 'getPreference'])->name('preference.get');
Route::middleware('auth:api')->get('/user/get-preferences', [UserPreferenceController::class, 'getAllPreferences'])->name('preference.getAll');

// ------ User Meta ------ //
Route::middleware('auth:api')->post('/user/set-meta', [UserMetaController::class, 'setMeta'])->name('meta.set');
Route::middleware('auth:api')->post('/user/reset-meta', [UserMetaController::class, 'resetMeta'])->name('meta.reset');
Route::middleware('auth:api')->post('/user/get-meta', [UserMetaController::class, 'getMeta'])->name('meta.get');
Route::middleware('auth:api')->get('/user/get-all-meta', [UserMetaController::class, 'getAllMeta'])->name('meta.getAll');

// ------ Groups ------ //
Route::middleware('auth:api')->get('/roles', [RoleController::class, 'index']);

// ------ Groups ------ //
Route::middleware('auth:api')->get('/groups', [GroupController::class, 'index']);
Route::middleware('auth:api')->post('/groups/new', [GroupController::class, 'store']);

// ------ Nodes ------ //
Route::middleware('auth:api')->get('/groups/{group}/nodes', [NodeController::class, 'index']);
Route::middleware('auth:api')->post('/groups/{group}/nodes/new', [NodeController::class, 'store']);
Route::middleware('auth:api')->get('/groups/{group}/nodes/{node}/connections', [DeviceConnectionController::class, 'index']);
Route::middleware('auth:api')->post('/groups/{group}/nodes/{node}/users', [NodeUserController::class, 'store']);
Route::middleware('auth:api')->post('/groups/{group}/nodes/{node}/connections', [DeviceConnectionController::class, 'create']);
Route::middleware('auth:api')->get('/groups/{group}/nodes/{node}/connections/{connection}', [DeviceConnectionController::class, 'show']);
Route::middleware('auth:api')->patch('/groups/{group}/nodes/{node}/connections/{connection}', [DeviceConnectionController::class, 'update']);
Route::middleware('auth:api')->post('/groups/{group}/nodes/{node}/connections/{connection}/use', [DeviceConnectionController::class, 'use']);

// ------ Devices ------ //
Route::middleware('auth:api')->get('/groups/{group}/nodes/{node}/devices', [DeviceController::class, 'index']);
Route::middleware('auth:api')->post('/groups/{group}/nodes/{node}/devices', [DeviceController::class, 'store']);
Route::middleware('auth:api')->get('/groups/{group}/nodes/{node}/devices/{device}', [DeviceController::class, 'show']);
Route::middleware('auth:api')->patch('/devices/{device}', [DeviceController::class, 'update']);
Route::middleware('auth:api')->patch('/devices/{device}/origin-map', [OriginMapController::class, 'update']);
Route::middleware('auth:api')->post('/devices/{device}/origin-map/activate', [OriginMapController::class, 'activate']);
Route::middleware('auth:api')->get('/devices/{device}/files', [DeviceFileController::class, 'index']);
Route::middleware('auth:api')->get('/devices/{device}/files/{file}', [DeviceFileController::class, 'show']);
Route::middleware('auth:api')->get('/devices/{device}/files/{file}/download', [DeviceFileController::class, 'download']);
Route::middleware('auth:api')->post('/devices/{device}/files', [DeviceFileController::class, 'store']);
Route::middleware('auth:api')->get('/devices/{device}/available-file-types', [DeviceFileController::class, 'available']);

// ------ Schemas ------ //
Route::middleware('auth:api')->get('/clusters', [ClusterController::class, 'index']);

// ------ Schemas ------ //
Route::middleware('auth:api')->get('/device-schemas', [DeviceSchemaController::class, 'index']);
//Route::middleware('auth:api')->post('/device-schemas', [DeviceSchemaController::class, 'create']);
Route::middleware('auth:api')->get('/device-schemas/{schema}/versions', [DeviceSchemaVersionController::class, 'index']);

// ------ Edge Agent Config ------ //
Route::post('edge-agent-config', [EdgeAgentConfigurationController::class, 'show']);

// ------ Edge Agents ------ //
Route::middleware('auth:api')->get('/edge-agents', [EdgeAgentController::class, 'index']);
Route::middleware('auth:api')->post('/edge-agents', [EdgeAgentController::class, 'updateAll']);
Route::middleware('auth:api')->post('/edge-agents/{namespace}/{name}', [EdgeAgentController::class, 'update']);
