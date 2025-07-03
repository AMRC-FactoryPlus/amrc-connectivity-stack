# OPC UA Server Development Guide

This guide covers local development and testing of the ACS OPC UA Server.

## Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- An OPC UA client for testing (optional)

### Local Development with Docker Compose

1. **Start the development environment:**
   ```bash
   docker-compose -f docker-compose.dev.yml up -d
   ```

   This will start:
   - InfluxDB with test data
   - OPC UA Server
   - Test data generator

2. **Check service health:**
   ```bash
   # Check HTTP endpoints
   curl http://localhost:8080/ping
   curl http://localhost:8080/status
   
   # Check InfluxDB
   curl http://localhost:8086/ping
   ```

3. **Test OPC UA connectivity:**
   ```bash
   npm test
   ```

4. **View logs:**
   ```bash
   docker-compose -f docker-compose.dev.yml logs -f opcua-server
   ```

5. **Stop the environment:**
   ```bash
   docker-compose -f docker-compose.dev.yml down
   ```

### Native Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up InfluxDB:**
   ```bash
   # Start InfluxDB
   docker run -d --name influxdb \
     -p 8086:8086 \
     -e DOCKER_INFLUXDB_INIT_MODE=setup \
     -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
     -e DOCKER_INFLUXDB_INIT_PASSWORD=password123 \
     -e DOCKER_INFLUXDB_INIT_ORG=default \
     -e DOCKER_INFLUXDB_INIT_BUCKET=uns \
     -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=test-token-123456789 \
     influxdb:2.7
   
   # Generate test data
   chmod +x test/generate-test-data.sh
   INFLUX_TOKEN=test-token-123456789 ./test/generate-test-data.sh
   ```

3. **Configure environment:**
   ```bash
   export INFLUX_URL="http://localhost:8086"
   export INFLUX_TOKEN="test-token-123456789"
   export INFLUX_ORG="default"
   export INFLUX_BUCKET="uns"
   export VERBOSE="ALL"
   
   # Mock Factory+ services (not needed for basic testing)
   export DIRECTORY_URL="http://localhost:8080"
   export AUTHN_URL="http://localhost:8080"
   export SERVICE_USERNAME="test-user"
   export SERVICE_PASSWORD="test-password"
   ```

4. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

5. **Test the server:**
   ```bash
   npm test
   ```

## Testing with OPC UA Clients

### UaExpert (Windows)
1. Download UaExpert from Unified Automation
2. Connect to: `opc.tcp://localhost:4840/UA/FactoryPlusUNS`
3. Browse the address space under `FactoryPlusUNS`
4. Read values from variables

### Node.js Client
```javascript
const { OPCUAClient } = require("node-opcua");

async function testClient() {
    const client = OPCUAClient.create({
        endpointMustExist: false
    });
    
    await client.connect("opc.tcp://localhost:4840/UA/FactoryPlusUNS");
    const session = await client.createSession();
    
    // Browse the address space
    const browseResult = await session.browse("RootFolder");
    console.log("Root references:", browseResult.references.length);
    
    // Read a variable (adjust path based on your test data)
    const nodeId = "ns=1;s=FactoryPlusUNS/Production/Line1/Robot1/Sensors/Temperature";
    const dataValue = await session.readVariableValue(nodeId);
    console.log("Temperature:", dataValue.value.value);
    
    await session.close();
    await client.disconnect();
}

testClient().catch(console.error);
```

### Python Client
```python
from opcua import Client

client = Client("opc.tcp://localhost:4840/UA/FactoryPlusUNS")
client.connect()

# Browse root
root = client.get_root_node()
children = root.get_children()
print(f"Root has {len(children)} children")

# Read a variable
try:
    node = client.get_node("ns=1;s=FactoryPlusUNS/Production/Line1/Robot1/Sensors/Temperature")
    value = node.get_value()
    print(f"Temperature: {value}")
except Exception as e:
    print(f"Error reading variable: {e}")

client.disconnect()
```

## Test Data Structure

The test data generator creates the following structure:

```
FactoryPlusUNS/
├── Production/
│   └── Line1/
│       ├── Robot1/
│       │   ├── Sensors/
│       │   │   ├── Temperature (Double)
│       │   │   └── Pressure (Double)
│       │   ├── Status/
│       │   │   └── Running (Boolean)
│       │   └── Counters/
│       │       ├── PartsProduced (Int32)
│       │       └── CycleTime (Double)
│       └── Conveyor1/
│           ├── Motor/
│           │   ├── Speed (Double)
│           │   └── Load (Double)
│           └── Status/
│               └── Enabled (Boolean)
├── Quality/
│   └── Lab/
│       └── Tester1/
│           ├── Results/
│           │   ├── TestResult (Boolean)
│           │   └── Measurement (Double)
│           └── Counters/
│               └── TestsCompleted (Int32)
└── Utilities/
    └── HVAC/
        └── Unit1/
            ├── Environment/
            │   ├── RoomTemperature (Double)
            │   └── Humidity (Double)
            └── Control/
                └── FanSpeed (Int32)
```

## Debugging

### Enable Verbose Logging
```bash
export VERBOSE="ALL"
npm start
```

### Check InfluxDB Data
```bash
# Access InfluxDB UI
open http://localhost:8086

# Or use CLI
docker exec -it influxdb influx query 'from(bucket:"uns") |> range(start:-1h) |> limit(n:10)'
```

### Common Issues

1. **OPC UA Connection Refused**
   - Check if server is running: `curl http://localhost:8080/ping`
   - Verify port 4840 is not blocked
   - Check server logs for errors

2. **No Data in Address Space**
   - Verify InfluxDB connection: `curl http://localhost:8086/ping`
   - Check if test data was generated
   - Review InfluxDB bucket and token configuration

3. **Authentication Errors**
   - For development, authentication is mocked
   - Check service account configuration
   - Verify Factory+ service URLs (can be mocked for testing)

## Building and Deployment

### Build Docker Image
```bash
docker build -t acs-opcua-server .
```

### Run with Custom Configuration
```bash
docker run -d \
  --name opcua-server \
  -p 4840:4840 \
  -p 8080:8080 \
  -e INFLUX_URL=http://your-influxdb:8086 \
  -e INFLUX_TOKEN=your-token \
  acs-opcua-server
```

## Contributing

1. Follow the existing code style
2. Add tests for new functionality
3. Update documentation
4. Test with the provided test suite

### Code Structure
- `bin/opcua-server.js` - Main entry point
- `lib/server.js` - OPC UA server implementation
- `lib/influx-client.js` - InfluxDB data access
- `lib/auth.js` - Authentication and authorization
- `lib/address-space.js` - OPC UA address space builder
- `test/` - Test scripts and utilities

### Adding New Features
1. Implement the feature in the appropriate module
2. Add configuration options if needed
3. Update the test suite
4. Document the changes
5. Test with real OPC UA clients
