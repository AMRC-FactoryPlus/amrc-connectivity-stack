# @amrc-factoryplus/mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for the AMRC Connectivity Stack (ACS). Enables AI agents (Claude, Cursor, etc.) to interact with Factory+ services including ConfigDB, Auth, and Directory.

## Installation

The package is published to npm and can be run via `npx`:

```bash
npx -y @amrc-factoryplus/mcp
```

## Configuration

Set the following environment variables:

| Variable           | Required | Description                                 |
|--------------------|----------|---------------------------------------------|
| `DIRECTORY_URL`    | Yes      | URL of the ACS Directory service            |
| `SERVICE_USERNAME` | Yes      | Service account username                    |
| `SERVICE_PASSWORD` | Yes      | Service account password                    |
| `INFLUX_URL`       | No       | InfluxDB URL (e.g. `http://localhost:8086`) |
| `INFLUX_TOKEN`     | No       | InfluxDB authentication token               |
| `INFLUX_ORG`       | No       | InfluxDB organisation name                  |
| `INFLUX_BUCKET`    | No       | Default bucket name (default: `default`)    |


## Usage with MCP Clients

MCP clients run commands with minimal environments, so you must provide:
1. **Full path** to `npx` as the command
2. **PATH** environment variable so the package can find `node`

First, find your Node.js paths:

```bash
which npx   # e.g. /opt/homebrew/bin/npx
which node  # e.g. /opt/homebrew/bin/node (use the directory, not the file)
```

### MCP Clients

You may need to use the full path to npx and include PATH:

```json
{
  "acs": {
    "command": "/opt/homebrew/bin/npx",
    "args": ["-y", "@amrc-factoryplus/mcp"],
    "env": {
      "PATH": "/opt/homebrew/bin:/usr/bin:/bin",
      "DIRECTORY_URL": "https://directory.your-acs.example.com",
      "SERVICE_USERNAME": "your-service-account",
      "SERVICE_PASSWORD": "your-password"
    }
  }
}
```

> **Note:** Replace `/opt/homebrew/bin` with your actual Node.js bin directory (from `which npx`).

## Available Tools

### ConfigDB Tools

| Tool                   | Description                                     |
|------------------------|-------------------------------------------------|
| `list_apps`            | List all registered applications                |
| `get_config`           | Fetch config by app UUID and object UUID        |
| `list_configs`         | List all objects with config for an application |
| `search_configs`       | Search configs with JSONPath query              |
| `get_class_members`    | List all members of a class (recursive)         |
| `get_class_subclasses` | List all subclasses of a class (recursive)      |
| `get_object_info`      | Get registration and general info for an object |

### Auth Tools

| Tool              | Description                                       |
|-------------------|---------------------------------------------------|
| `list_principals` | List all principal UUIDs                          |
| `find_principal`  | Find info by Kerberos/UUID/Sparkplug ID           |
| `check_acl`       | Check if a principal has a permission on a target |
| `list_grants`     | List all permission grant UUIDs                   |
| `get_grant`       | Get details of a specific grant                   |
| `find_grants`     | Search grants by principal/permission/target      |
| `whoami`          | Get current authenticated identity                |

### Directory Tools

| Tool                 | Description                                          |
|----------------------|------------------------------------------------------|
| `get_device_info`    | Get device details (address, schemas, online status) |
| `get_device_address` | Get Sparkplug address for a device UUID              |
| `get_service_info`   | Get full service registration (URL + device)         |
| `get_service_url`    | Get HTTP endpoint URL for a service UUID             |

### Documentation Tools

| Tool               | Description                          |
|--------------------|--------------------------------------|
| `search_docs`      | Search ACS documentation on GitHub   |
| `list_docs`        | List available documentation files   |
| `read_doc`         | Read a specific documentation file   |
| `search_portal`    | Search Factory+ documentation portal |
| `read_portal_page` | Read a Factory+ portal page          |

### InfluxDB Tools (optional — requires `INFLUX_*` env vars)

| Tool                       | Description                                                        |
|----------------------------|--------------------------------------------------------------------|
| `influx_query`             | Execute a raw Flux query                                           |
| `influx_list_buckets`      | List available InfluxDB buckets                                    |
| `influx_list_measurements` | List measurements in a bucket (with optional ACS tag filters)      |
| `influx_get_latest`        | Get latest value(s) filtered by ACS tags (device, schema, ISA-95)  |
| `influx_get_history`       | Get historical data with time range, aggregation, and tag filters  |
| `influx_list_tag_values`   | List unique values for any ACS tag (groups, devices, schemas, etc) |

All InfluxDB tools understand ACS conventions: Sparkplug addressing (`group`/`node`/`device`), Schema and Instance UUIDs, ISA-95 hierarchy tags, and the `metricName:typeSuffix` measurement naming pattern.

## Development

```bash
# Clone and install
cd acs-mcp
npm install

# Build TypeScript
npm run build

# Run locally
npm run start
```

### Using a Local Build with MCP Clients

To point your MCP client at your local build instead of the published npm package, use `node` directly with the built entry point instead of `npx`:

```json
{
    "mcpServers": {
        "acs-configdb": {
            "command": "/path/to/node",
            "args": [
                "/path/to/amrc-connectivity-stack/acs-mcp/dist/index.js"
            ],
            "env": {
                "PATH": "/path/to/node/bin:/usr/bin:/bin",
                "DIRECTORY_URL": "http://directory.your-acs.example.com",
                "SERVICE_USERNAME": "your-service-account",
                "SERVICE_PASSWORD": "your-password",
                "INFLUX_URL": "http://influxdb.your-acs.example.com",
                "INFLUX_TOKEN": "your-influx-token",
                "INFLUX_ORG": "default",
                "INFLUX_BUCKET": "default"
            }
        }
    }
}
```

> **Note:** Remember to run `npm run build` after making changes — the MCP client runs the compiled `dist/index.js`, not the TypeScript source.

## Publishing

```bash
npm run build
npm publish --access public
```

## License

MIT - see [LICENSE](../LICENSE)
