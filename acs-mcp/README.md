# @amrc-factoryplus/mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for the AMRC Connectivity Stack (ACS). Enables AI agents (Claude, Cursor, etc.) to interact with Factory+ services including ConfigDB, Auth, and Directory.

## Installation

The package is published to npm and can be run via `npx`:

```bash
npx -y @amrc-factoryplus/mcp
```

## Configuration

Set the following environment variables:

| Variable           | Required | Description                      |
|--------------------|----------|----------------------------------|
| `DIRECTORY_URL`    | Yes      | URL of the ACS Directory service |
| `SERVICE_USERNAME` | Yes      | Service account username         |
| `SERVICE_PASSWORD` | Yes      | Service account password         |

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

## Publishing

```bash
npm run build
npm publish --access public
```

## License

MIT - see [LICENSE](../LICENSE)
