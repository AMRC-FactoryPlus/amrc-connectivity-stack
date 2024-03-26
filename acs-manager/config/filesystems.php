<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application. Just store away!
    |
    */

    'default' => env('FILESYSTEM_DRIVER', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Default Cloud Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Many applications store files both locally and in the cloud. For this
    | reason, you may specify a default "cloud" driver here. This driver
    | will be bound as the Cloud disk implementation in the container.
    |
    */

    'cloud' => env('FILESYSTEM_CLOUD', 's3'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Here you may configure as many filesystem "disks" as you wish, and you
    | may even configure multiple disks of the same driver. Defaults have
    | been setup for each driver as an example of the required options.
    |
    | Supported Drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app'),
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => env('APP_URL') . '/storage',
            'visibility' => 'public',
        ],

        'schemas' => [
            'driver' => 's3',
            'endpoint' => env('MINIO_ENDPOINT', 'http://127.0.0.1:9000'),
            'use_path_style_endpoint' => true,
            'key' => env('MINIO_KEY'),
            'secret' => env('MINIO_SECRET'),
            'region' => 'us-east-1',
            'bucket' => 'schemas',
            'throw' => true,
        ],

        'device-configurations' => [
            'driver' => 's3',
            'endpoint' => env('MINIO_ENDPOINT', 'http://127.0.0.1:9000'),
            'use_path_style_endpoint' => true,
            'key' => env('MINIO_KEY'),
            'secret' => env('MINIO_SECRET'),
            'region' => 'us-east-1',
            'bucket' => 'device-configurations',
            'throw' => true,
        ],

        'device-connections' => [
            'driver' => 's3',
            'endpoint' => env('MINIO_ENDPOINT', 'http://127.0.0.1:9000'),
            'use_path_style_endpoint' => true,
            'key' => env('MINIO_KEY'),
            'secret' => env('MINIO_SECRET'),
            'region' => 'us-east-1',
            'bucket' => 'device-connections',
            'throw' => true,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
