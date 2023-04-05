<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

return [
    'organisation' => env('APP_ORGANISATION', 'AMRC'),
    'namespace' => env('APP_NAMESPACE', 'factory-plus'),
    'domain' => env('KRB_DOMAIN', ''),
    'service_domain' => env('SERVICE_DOMAIN', ''),
    'manager_service_principal' => env('MANAGER_SERVICE_PRINCIPAL', ''),
    'multi_cluster' => env('MULTI_CLUSTER', false),
    'clusters' => env('CLUSTERS', 'amrc'),
    'mqtt_server_from_edge' => env('MQTT_SERVER_FROM_EDGE', 'mqtt://mqtt:1883'),
    'management_app_from_edge' => env('MANAGEMENT_APP_FROM_EDGE', 'http://manager'),
    'tgt_lifetime' => 3600,
    'service_scheme' => env('SERVICE_SCHEME', 'https'),
    'auth_service_url' => env('AUTH_SERVICE_URL'),
    'configdb_service_url' => env('CONFIGDB_SERVICE_URL'),
    'file_service_url' => env('FILE_SERVICE_ENDPOINT', 'http://localhost:9990') . '/api',
    'cmdesc_service_url' => env('CMDESC_SERVICE_ENDPOINT', 'http://localhost:9990'),
    'keytab_path' => env('KEYTAB_PATH', '/config/keytab/client-keytab'),
    'new_edge_agents' => [
        'registry' => env('NEW_EDGE_AGENT_REGISTRY', 'ghcr.io/amrc-factoryplus'),
        'repository' => env('NEW_EDGE_AGENT_REPOSITORY', 'acs-edge'),
        'version' => env('NEW_EDGE_AGENT_VERSION', 'latest'),
        'debug' => env('NEW_EDGE_AGENT_DEBUG', 'true'),
        'pollInterval' => env('NEW_EDGE_AGENT_POLL_INTERVAL', '10'),
    ],
];
