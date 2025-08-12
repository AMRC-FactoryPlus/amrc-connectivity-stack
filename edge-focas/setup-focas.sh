#!/bin/bash

#
# Copyright (c) University of Sheffield AMRC 2025.
#

# FOCAS Library Setup Script for Linux
# This script helps set up the Fanuc FOCAS library for use with the edge-focas driver

set -e

echo "=== Fanuc FOCAS Library Setup ==="

# Check if running as root for system-wide installation
if [[ $EUID -eq 0 ]]; then
    INSTALL_DIR="/usr/local/lib"
    echo "Installing system-wide to $INSTALL_DIR"
else
    INSTALL_DIR="$HOME/.local/lib"
    mkdir -p "$INSTALL_DIR"
    echo "Installing to user directory $INSTALL_DIR"
fi

# Function to download and setup FOCAS library
setup_focas_library() {
    echo "Setting up FOCAS library..."
    
    # Check if library already exists
    if [ -f "$INSTALL_DIR/libfwlib32.so" ]; then
        echo "FOCAS library already exists at $INSTALL_DIR/libfwlib32.so"
        return 0
    fi
    
    echo "FOCAS library not found. Please follow these steps:"
    echo ""
    echo "1. Download the FOCAS library from Fanuc:"
    echo "   - Contact your Fanuc representative or visit the Fanuc website"
    echo "   - Download the Linux version of the FOCAS library"
    echo "   - The library is typically named 'libfwlib32.so' or similar"
    echo ""
    echo "2. Copy the library to: $INSTALL_DIR/libfwlib32.so"
    echo ""
    echo "3. Make sure the library has proper permissions:"
    echo "   chmod 755 $INSTALL_DIR/libfwlib32.so"
    echo ""
    echo "4. Update your library path (add to ~/.bashrc or /etc/ld.so.conf):"
    echo "   export LD_LIBRARY_PATH=\$LD_LIBRARY_PATH:$INSTALL_DIR"
    echo ""
    echo "5. Run 'ldconfig' (as root) or 'ldconfig -n $INSTALL_DIR' to update library cache"
    echo ""
    
    read -p "Have you completed these steps? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please complete the FOCAS library setup and run this script again."
        exit 1
    fi
    
    # Verify library exists
    if [ ! -f "$INSTALL_DIR/libfwlib32.so" ]; then
        echo "Error: FOCAS library not found at $INSTALL_DIR/libfwlib32.so"
        exit 1
    fi
    
    echo "FOCAS library found!"
}

# Function to test library loading
test_library() {
    echo "Testing FOCAS library..."
    
    # Try to load the library with ldd
    if command -v ldd >/dev/null 2>&1; then
        echo "Checking library dependencies:"
        ldd "$INSTALL_DIR/libfwlib32.so" || echo "Warning: Could not check dependencies"
    fi
    
    # Test with a simple Node.js script
    cat > /tmp/test_focas.js << 'EOF'
const ffi = require('ffi-napi');
const path = process.argv[2];

try {
    console.log('Attempting to load FOCAS library from:', path);
    const lib = ffi.Library(path, {
        'cnc_allclibhndl3': ['short', ['string', 'ushort', 'long', 'pointer']]
    });
    console.log('✓ FOCAS library loaded successfully!');
    console.log('✓ cnc_allclibhndl3 function found');
} catch (error) {
    console.error('✗ Failed to load FOCAS library:', error.message);
    process.exit(1);
}
EOF
    
    if command -v node >/dev/null 2>&1; then
        echo "Testing library loading with Node.js..."
        if npm list ffi-napi >/dev/null 2>&1; then
            node /tmp/test_focas.js "$INSTALL_DIR/libfwlib32.so"
        else
            echo "Warning: ffi-napi not installed, skipping Node.js test"
        fi
    else
        echo "Warning: Node.js not found, skipping library test"
    fi
    
    rm -f /tmp/test_focas.js
}

# Function to create configuration template
create_config_template() {
    echo "Creating configuration template..."
    
    cat > edge-focas-config.json << 'EOF'
{
  "host": "192.168.1.100",
  "port": 8193,
  "timeout": 5000,
  "libraryPath": "/usr/local/lib/libfwlib32.so"
}
EOF
    
    # Update library path in template
    sed -i "s|/usr/local/lib/libfwlib32.so|$INSTALL_DIR/libfwlib32.so|" edge-focas-config.json
    
    echo "Configuration template created: edge-focas-config.json"
    echo "Please edit this file with your CNC's IP address and settings."
}

# Main execution
echo "Checking system requirements..."

# Check for required tools
if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required but not installed."
    exit 1
fi

echo "✓ npm found"

# Setup FOCAS library
setup_focas_library

# Test library
test_library

# Create config template
create_config_template

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit edge-focas-config.json with your CNC settings"
echo "2. Install Node.js dependencies: npm install"
echo "3. Run the driver: npm start"
echo ""
echo "Library path configured: $INSTALL_DIR/libfwlib32.so"
echo ""
echo "If you encounter issues:"
echo "- Ensure the FOCAS library is compatible with your Linux distribution"
echo "- Check that all library dependencies are installed"
echo "- Verify network connectivity to your CNC controller"
echo "- Check CNC FOCAS settings (port, timeout, etc.)"
