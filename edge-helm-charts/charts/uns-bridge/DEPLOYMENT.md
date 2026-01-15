# UNS Bridge - Production Deployment Guide

## Integration with Edge Deployment Manager

To make the UNS Bridge available as a deployment option in the Edge Deployment Manager, follow these steps:

## Step 1: Update ACS Service Setup

The UNS Bridge chart needs to be registered in the service setup configuration.

### Check Current Integration

The chart is already referenced in `acs-service-setup/dumps/helm.yaml`:

```yaml
!u Local.Chart.UNSBridge:
  chart:  "uns-bridge"
  values:
    name:   "{{name}}"
    uuid:   "{{uuid}}"
    hostname: "{{hostname}}"
    authGroup:
      unsReader: !u UNS.Group.Reader
```

This should make it available for deployment via the Edge Deployment Manager.

## Step 2: Build and Release

### Build the ACS Release

```bash
# From the root of amrc-connectivity-stack
cd acs-service-setup

# Build the service setup
npm install
npm run build

# This will generate the configuration that includes the UNS Bridge chart
```

### Tag and Push Edge Helm Charts

```bash
cd edge-helm-charts

# Update Chart.yaml version if needed
# Then package and push to your chart repository
helm package charts/uns-bridge
# Push to your Helm repository
```

## Step 3: Deploy via Edge Deployment Manager

### Prerequisites

1. **Create Remote Broker Credentials Secret**

   On the edge cluster, create a SealedSecret with the remote broker credentials:

   ```bash
   # Create temporary secret
   cat <<EOF > /tmp/remote-mqtt-creds.yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: remote-mqtt-creds
     namespace: factory-plus
   type: Opaque
   stringData:
     username: <remote-username>
     password: <remote-password>
   EOF

   # Seal it (get the sealing cert from your cluster)
   kubeseal --cert <sealing-cert.pem> --format=yaml \
     < /tmp/remote-mqtt-creds.yaml > remote-mqtt-creds-sealed.yaml

   # Commit to your edge cluster repo
   git add remote-mqtt-creds-sealed.yaml
   git commit -m "Add remote MQTT credentials for UNS bridge"
   git push

   # Clean up
   rm /tmp/remote-mqtt-creds.yaml
   ```

2. **Prepare Bridge Configuration**

   You'll need:
   - Bridge name (e.g., "production-bridge")
   - Unique UUID for the bridge instance
   - Remote broker hostname and port
   - Topic filters to bridge

### Deploy from Manager UI

1. Navigate to the Edge Deployment Manager
2. Select your edge cluster
3. Click "Add Deployment"
4. Select "UNS Bridge" from the chart dropdown
5. Fill in the configuration:
   - **Name**: Bridge instance name
   - **UUID**: Generate a new UUID
   - **Cluster**: Your cluster name
   - **Realm**: Your Kerberos realm
   - **Topics**: UNS topic filters (e.g., `UNS/v1/#`)
   - **Remote Host**: Remote broker hostname
   - **Remote Port**: Remote broker port
   - **Remote TLS**: Enable if using TLS
   - **Secret Name**: `remote-mqtt-creds` (or your secret name)

6. Click "Deploy"

The manager will:
- Create the Helm release on the edge cluster
- Create the KerberosKey resource
- The KerberosKey operator will create the account and credentials
- The bridge pod will start and begin forwarding messages

## Step 4: Verify Deployment

### Check Deployment Status

```bash
# List all UNS Bridge deployments
kubectl get all -n factory-plus -l factory-plus.app=uns-bridge

# Check specific bridge logs
kubectl logs -n factory-plus deployment/uns-bridge-<bridge-name> -f
```

### Verify Message Flow

1. **Subscribe to remote broker** to see incoming messages
2. **Publish to local ACS** and verify messages appear on remote
3. **Check MQTT broker logs** for authentication/authorization issues

## Step 5: Testing Checklist

- [ ] Remote credentials secret created and sealed
- [ ] Bridge deployment appears in Edge Manager
- [ ] KerberosKey created successfully
- [ ] Account created in ConfigDB with UNS.Group.Reader membership
- [ ] Bridge pod running without errors
- [ ] Both bridge connections established (check logs)
- [ ] Messages flowing from local to remote
- [ ] No authentication errors in MQTT broker logs

## Troubleshooting Production Deployments

### Bridge not appearing in Manager dropdown

- Verify `acs-service-setup` has been rebuilt with latest helm.yaml
- Check that the chart is available in your Helm repository
- Verify the chart version matches what's expected

### Deployment fails with "secret not found"

- Ensure the remote credentials SealedSecret has been created
- Verify the secret name in values matches the actual secret name
- Check that the secret is in the correct namespace

### Authentication failures

- Verify the Kerberos realm is correct
- Check that the cluster name matches your setup
- Ensure UNS.Group.Reader UUID is correct for your installation

### No messages flowing

- Check topic filters match your UNS structure
- Verify local MQTT broker has data on those topics
- Test remote broker credentials manually
- Check bridge logs for subscription confirmations

## Production Considerations

### Security

- Use TLS for remote connections when possible
- Rotate remote credentials regularly
- Monitor bridge authentication logs
- Restrict topic filters to only necessary data

### Performance

- Monitor bridge pod resource usage
- Consider QoS levels for message delivery guarantees
- Use appropriate topic filters to avoid unnecessary traffic
- Monitor message rates and latency

### High Availability

- Currently single-instance only (no HA support)
- Consider multiple bridges with different topic filters for redundancy
- Monitor bridge uptime and restart on failure

## Next Steps

After successful deployment:

1. Monitor message flow and latency
2. Verify data integrity on remote broker
3. Set up alerting for bridge failures
4. Document your specific bridge configuration
5. Plan for credential rotation

