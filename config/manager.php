<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

return [
    'organisation' => env('APP_ORGANISATION', 'AMRC'),
    'namespace' => env('APP_NAMESPACE', 'factory-plus'),
    'base_url' => env('BASE_URL', ''),
    'realm' => env('REALM', ''),
    'scheme' => env('SERVICE_SCHEME', 'https'),
    'manager_service_principal' => env('MANAGER_SERVICE_PRINCIPAL', ''),
    'manager_client_principal' => env('MANAGER_CLIENT_PRINCIPAL', 'sv1manager'),
    'tgt_lifetime' => 3600,
    'keytab_path' => env('KEYTAB_PATH', '/config/keytab/client-keytab'),
    'tkt_life' => env('TKT_LIFE', 21600),
];
