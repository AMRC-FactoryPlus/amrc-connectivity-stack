# ACS OPC UA Server

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `acs-opcua-server` service provides OPC UA access to data stored in the Factory+ Unified Namespace (UNS). It acts as a bridge between OPC UA clients and the InfluxDB backend where UNS data is stored.

## Features

- **OPC UA Server**: Provides standard OPC UA access to UNS data
- **Authentication Integration**: Uses Factory+ authentication service for user validation
- **Authorization**: Leverages MQTT permissions to control data access
- **Dynamic Address Space**: Builds OPC UA address space from InfluxDB data structure
- **Real-time Data**: Provides current values and timestamps from InfluxDB
- **Hierarchical Organization**: Organizes data as Group/Node/Device/Path/Measurement

## Architecture

The OPC UA Server acts as a proxy between OPC UA clients and the InfluxDB backend:

```
OPC UA Client → OPC UA Server → InfluxDB (UNS Data)
                     ↓
              Factory+ Auth Service
```

## Data Structure

The OPC UA address space is organized hierarchically based on the UNS structure:

```
Root/
├── FactoryPlusUNS/
    ├── Group1/
    │   ├── Node1/
    │   │   ├── Device1/
    │   │   │   ├── Path1/
    │   │   │   │   ├── Measurement1
    │   │   │   │   └── Measurement2
    │   │   │   └── Path2/
    │   │   │       └── Measurement3
    │   │   └── Device2/
    │   └── Node2/
    └── Group2/
```

## Configuration

The service is configured through environment variables:

### OPC UA Configuration
- `OPCUA_PORT`: OPC UA server port (default: 4840)
- `OPCUA_HOSTNAME`: OPC UA server hostname (default: 0.0.0.0)
- `HTTP_PORT`: HTTP management interface port (default: 8080)

### InfluxDB Configuration
- `INFLUX_URL`: InfluxDB server URL
- `INFLUX_TOKEN`: InfluxDB authentication token
- `INFLUX_ORG`: InfluxDB organization (default: default)
- `INFLUX_BUCKET`: InfluxDB bucket name (default: uns)

### Factory+ Configuration
- `DIRECTORY_URL`: Factory+ Directory service URL
- `AUTHN_URL`: Factory+ Authentication service URL
- `CONFIGDB_URL`: Factory+ ConfigDB service URL
- `MQTT_URL`: Factory+ MQTT broker URL
- `SERVICE_USERNAME`: Service account username
- `SERVICE_PASSWORD`: Service account password

### Logging
- `VERBOSE`: Logging verbosity level

## Security

### Authentication
The OPC UA server supports multiple authentication methods:
- **Anonymous**: Allowed by default, controlled by MQTT permissions
- **Username/Password**: Validated against Factory+ authentication service
- **Certificate**: Future enhancement for certificate-based authentication

### Authorization
Access control is implemented through the Factory+ MQTT permission system:
- Users must have UNS read permissions to access data
- Permissions are checked per data path
- Anonymous access can be configured per deployment

### Security Policies
The server supports multiple OPC UA security policies:
- None (no encryption)
- Basic128Rsa15
- Basic256
- Basic256Sha256

## API Endpoints

### Health Check
- `GET /ping`: Simple health check
- `GET /status`: Detailed service status

## Development

### Prerequisites
- Node.js 18+
- Access to InfluxDB with UNS data
- Factory+ authentication service

### Running Locally
```bash
npm install
npm start
```

### Environment Setup
```bash
export INFLUX_URL="http://localhost:8086"
export INFLUX_TOKEN="your-influx-token"
export INFLUX_BUCKET="uns"
export DIRECTORY_URL="http://localhost:8080"
export AUTHN_URL="http://localhost:8080"
# ... other environment variables
```

## Deployment

The service is deployed as part of the ACS Helm chart. Enable it in your values.yaml:

```yaml
opcuaServer:
  enabled: true
  replicas: 1
  influx:
    url: "http://acs-influxdb2:8086"
    bucket: "uns"
  service:
    type: ClusterIP
```

## Monitoring

The service provides health check endpoints for monitoring:
- Kubernetes liveness/readiness probes use `/ping`
- Detailed status available at `/status`

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check that the OPC UA port (4840) is accessible
2. **No Data**: Verify InfluxDB connection and UNS data availability
3. **Authentication Failed**: Check Factory+ auth service configuration
4. **Permission Denied**: Verify MQTT permissions for the user

### Logs
Enable verbose logging with `VERBOSE=ALL` environment variable.

## Contributing

This service follows the standard ACS development patterns. See the main ACS repository for contribution guidelines.

## License

This project is licensed under the same terms as the AMRC Connectivity Stack.
