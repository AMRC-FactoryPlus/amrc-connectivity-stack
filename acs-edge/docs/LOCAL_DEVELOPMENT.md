# Local Development Setup for Edge Agent

## Driver Password Configuration

When running the Edge Agent locally for testing with external drivers, you need to configure driver authentication.

### Quick Setup

1. **Update `.env` file** to point to a local password directory:
   ```
   EDGE_PASSWORDS=c:/Users/sphar/acs_local/amrc-connectivity-stack/acs-edge/driver-passwords
   ```

2. **Create password files** for each driver connection:
   - The file path should be: `${EDGE_PASSWORDS}/${USERNAME}`
   - For username `nd1/Soft_Cluster/Dev_Node`, create: `driver-passwords/nd1/Soft_Cluster/Dev_Node`
   - The file should contain only the password (no newline)

### Using the Helper Script

You can use the PowerShell helper script:

```powershell
.\scripts\create-driver-password.ps1 -Username "nd1/Soft_Cluster/Dev_Node" -Password "your-password-here"
```

### Manual Setup

```powershell
# Create directory structure
New-Item -ItemType Directory -Force -Path ".\driver-passwords\nd1\Soft_Cluster"

# Create password file (PowerShell)
[System.IO.File]::WriteAllText(".\driver-passwords\nd1\Soft_Cluster\Dev_Node", "**Password**")
```

### Testing

1. Start the Edge Agent:
   ```powershell
   cd acs-edge
   node .\build\app.js
   ```

2. In another terminal, start your driver with the same credentials:
   ```powershell
   cd edge-rtde
   # Ensure .env has:
   # EDGE_USERNAME=nd1/Soft_Cluster/Dev_Node
   # EDGE_PASSWORD=**Password**
   # EDGE_MQTT=mqtt://localhost:1883
   
   node .\bin\driver.js
   ```

3. The driver should now authenticate successfully!

### Security Note

- The `driver-passwords` directory is in `.gitignore` to prevent committing secrets
- In production, passwords are managed by Kubernetes secrets
- For local testing, you can use any password you want, just make sure it matches between the driver and the Edge Agent

### Troubleshooting

**Error: "Unknown user"**
- Check that the password file exists at the correct path
- Verify the path in EDGE_PASSWORDS matches your actual directory
- Check that the username in the driver matches the filename

**Error: "Bad password"**
- Ensure the password file contains exactly the same string as EDGE_PASSWORD in the driver
- Check there are no extra newlines or spaces in the password file

**Error: "No password for undefined"**
- The driver's EDGE_USERNAME environment variable is not set
- Check the driver's .env file
