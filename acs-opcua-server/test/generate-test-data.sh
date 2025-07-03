#!/bin/sh

# Generate test data for OPC UA Server testing
# This script populates InfluxDB with sample UNS data

echo "Generating test data for OPC UA Server..."

INFLUX_URL=${INFLUX_URL:-http://localhost:8086}
INFLUX_TOKEN=${INFLUX_TOKEN:-test-token-123456789}
INFLUX_ORG=${INFLUX_ORG:-default}
INFLUX_BUCKET=${INFLUX_BUCKET:-uns}

# Wait for InfluxDB to be ready
echo "Waiting for InfluxDB to be ready..."
for i in $(seq 1 30); do
    if curl -s "${INFLUX_URL}/ping" > /dev/null 2>&1; then
        echo "InfluxDB is ready"
        break
    fi
    echo "Waiting for InfluxDB... ($i/30)"
    sleep 2
done

# Function to write data to InfluxDB
write_data() {
    local measurement=$1
    local tags=$2
    local fields=$3
    local timestamp=$4
    
    local line_protocol="${measurement},${tags} ${fields} ${timestamp}"
    
    curl -s -X POST "${INFLUX_URL}/api/v2/write?org=${INFLUX_ORG}&bucket=${INFLUX_BUCKET}" \
        -H "Authorization: Token ${INFLUX_TOKEN}" \
        -H "Content-Type: text/plain; charset=utf-8" \
        --data-binary "${line_protocol}"
}

# Generate timestamps (last hour with 1-minute intervals)
current_time=$(date +%s)
start_time=$((current_time - 3600))  # 1 hour ago

echo "Generating sample data..."

# Generate data for Production/Line1/Robot1
for i in $(seq 0 60); do
    timestamp=$((start_time + i * 60))
    timestamp_ns="${timestamp}000000000"  # Convert to nanoseconds
    
    # Temperature sensor (double)
    temp_value=$(echo "scale=2; 20 + 5 * s($i * 0.1)" | bc -l)
    write_data "Temperature:d" \
        "group=Production,node=Line1,device=Robot1,path=Sensors" \
        "value=${temp_value}" \
        "${timestamp_ns}"
    
    # Pressure sensor (double)
    pressure_value=$(echo "scale=2; 100 + 10 * s($i * 0.05)" | bc -l)
    write_data "Pressure:d" \
        "group=Production,node=Line1,device=Robot1,path=Sensors" \
        "value=${pressure_value}" \
        "${timestamp_ns}"
    
    # Running status (boolean)
    running_value=$((i % 10 < 8 ? 1 : 0))  # Running 80% of the time
    write_data "Running:b" \
        "group=Production,node=Line1,device=Robot1,path=Status" \
        "value=${running_value}" \
        "${timestamp_ns}"
    
    # Parts produced counter (integer)
    parts_value=$((i * 2 + (i % 5)))
    write_data "PartsProduced:i" \
        "group=Production,node=Line1,device=Robot1,path=Counters" \
        "value=${parts_value}" \
        "${timestamp_ns}"
    
    # Cycle time (double)
    cycle_time=$(echo "scale=2; 30 + 5 * s($i * 0.2)" | bc -l)
    write_data "CycleTime:d" \
        "group=Production,node=Line1,device=Robot1,path=Counters" \
        "value=${cycle_time}" \
        "${timestamp_ns}"
done

# Generate data for Production/Line1/Conveyor1
for i in $(seq 0 60); do
    timestamp=$((start_time + i * 60))
    timestamp_ns="${timestamp}000000000"
    
    # Speed (double)
    speed_value=$(echo "scale=2; 50 + 10 * s($i * 0.15)" | bc -l)
    write_data "Speed:d" \
        "group=Production,node=Line1,device=Conveyor1,path=Motor" \
        "value=${speed_value}" \
        "${timestamp_ns}"
    
    # Load (double)
    load_value=$(echo "scale=2; 75 + 15 * s($i * 0.1)" | bc -l)
    write_data "Load:d" \
        "group=Production,node=Line1,device=Conveyor1,path=Motor" \
        "value=${load_value}" \
        "${timestamp_ns}"
    
    # Enabled status (boolean)
    enabled_value=1
    write_data "Enabled:b" \
        "group=Production,node=Line1,device=Conveyor1,path=Status" \
        "value=${enabled_value}" \
        "${timestamp_ns}"
done

# Generate data for Quality/Lab/Tester1
for i in $(seq 0 60); do
    timestamp=$((start_time + i * 60))
    timestamp_ns="${timestamp}000000000"
    
    # Test result (boolean)
    test_result=$((i % 20 < 19 ? 1 : 0))  # 95% pass rate
    write_data "TestResult:b" \
        "group=Quality,node=Lab,device=Tester1,path=Results" \
        "value=${test_result}" \
        "${timestamp_ns}"
    
    # Measurement value (double)
    measurement_value=$(echo "scale=3; 1.000 + 0.001 * s($i * 0.3)" | bc -l)
    write_data "Measurement:d" \
        "group=Quality,node=Lab,device=Tester1,path=Results" \
        "value=${measurement_value}" \
        "${timestamp_ns}"
    
    # Tests completed (integer)
    tests_completed=$((i + 1))
    write_data "TestsCompleted:i" \
        "group=Quality,node=Lab,device=Tester1,path=Counters" \
        "value=${tests_completed}" \
        "${timestamp_ns}"
done

# Generate data for Utilities/HVAC/Unit1
for i in $(seq 0 60); do
    timestamp=$((start_time + i * 60))
    timestamp_ns="${timestamp}000000000"
    
    # Room temperature (double)
    room_temp=$(echo "scale=1; 22 + 2 * s($i * 0.05)" | bc -l)
    write_data "RoomTemperature:d" \
        "group=Utilities,node=HVAC,device=Unit1,path=Environment" \
        "value=${room_temp}" \
        "${timestamp_ns}"
    
    # Humidity (double)
    humidity=$(echo "scale=1; 45 + 5 * s($i * 0.08)" | bc -l)
    write_data "Humidity:d" \
        "group=Utilities,node=HVAC,device=Unit1,path=Environment" \
        "value=${humidity}" \
        "${timestamp_ns}"
    
    # Fan speed (integer)
    fan_speed=$((50 + (i % 30)))
    write_data "FanSpeed:i" \
        "group=Utilities,node=HVAC,device=Unit1,path=Control" \
        "value=${fan_speed}" \
        "${timestamp_ns}"
done

echo "Test data generation completed!"
echo ""
echo "Generated data for:"
echo "- Production/Line1/Robot1 (Temperature, Pressure, Running, PartsProduced, CycleTime)"
echo "- Production/Line1/Conveyor1 (Speed, Load, Enabled)"
echo "- Quality/Lab/Tester1 (TestResult, Measurement, TestsCompleted)"
echo "- Utilities/HVAC/Unit1 (RoomTemperature, Humidity, FanSpeed)"
echo ""
echo "You can now test the OPC UA server with this data."
