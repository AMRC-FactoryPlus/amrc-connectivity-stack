<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\FileService\Actions\DownloadFileForDeviceAction;
use App\Domain\FileService\Actions\GetAvailableFilesForDeviceAction;
use App\Domain\FileService\Actions\GetDeviceFileDetailsAction;
use App\Domain\FileService\Actions\GetDeviceFilesAction;
use App\Domain\FileService\Actions\UploadFileForDeviceAction;
use App\Exceptions\ActionFailException;
use App\Http\Requests\UploadFileForDeviceRequest;

use function request;

class DeviceFileController extends Controller
{
    public function index()
    {
        // Get the device
        $device = Device::where('id', request()?->route('device'))
                        ->with('node')
                        ->first();
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        return process_action((new GetDeviceFilesAction)->execute($device));
    }

    public function store(UploadFileForDeviceRequest $request)
    {
        $validated = $request->validated();

        // Get the device
        $device = Device::where('instance_uuid', $validated['instance_uuid'])
                        ->first();
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        return process_action(
            (new UploadFileForDeviceAction)->execute(
                device: $device,
                fileTypeKey: $validated['file_type_key'],
                friendlyTitle: $validated['friendly_title'],
                friendlyDescription: $validated['friendly_description'] ?? '',
                uploader: $validated['uploader'],
                file: $validated['file'],
                tags: json_decode($validated['tags'], false, 512, JSON_THROW_ON_ERROR) ?? [],
            )
        );
    }

    public function show()
    {
        return process_action((new GetDeviceFileDetailsAction)->execute(request()?->route('file')));
    }

    public function available()
    {
        // Get the device
        $device = Device::where('id', request()?->route('device'))
                        ->with('node')
                        ->first();
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        return process_action((new GetAvailableFilesForDeviceAction)->execute($device));
    }

    public function download()
    {
        $device = Device::where('id', request()?->route('device'))
                        ->with('node')
                        ->first();
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        return process_action((new DownloadFileForDeviceAction)->execute($device, request()?->route('file')));
    }
}
