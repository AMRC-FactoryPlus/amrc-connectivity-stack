# Git Repository Authentication

The ACS Git server supports automatic mirroring of external Git
repositories. When these repositories require authentication, you can
configure credentials using Kubernetes secrets.

## Configuring Authentication for External Repositories

To configure authentication for external repositories, you need to:

1. Create a Kubernetes secret containing the credentials
2. Reference the secret in the Git repository configuration
3. Configure the Git service to mount the secret

### 1. Creating a Credentials Secret

Create a Kubernetes secret containing the authentication credentials. The secret can be in one of two formats:

#### JSON Format

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-git-credentials
type: Opaque
stringData:
  github-credentials: |
    {
      "username": "myusername",
      "password": "mypassword"
    }
```

#### Simple Format

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-git-credentials
type: Opaque
stringData:
  github-credentials: "myusername:mypassword"
```

The key name in the secret (e.g., `github-credentials`) will be used as the reference in the Git repository configuration.

### 2. Referencing the Secret in Git Repository Configuration

When creating a Git repository configuration in ConfigDB, include an `auth` object with a `secretRef` property in the pull configuration:

```json
{
  "path": "shared/example-repo",
  "pull": {
    "main": {
      "url": "https://github.com/example/private-repo.git",
      "ref": "main",
      "interval": "1h",
      "auth": {
        "secretRef": "github-credentials"
      }
    }
  }
}
```

The `secretRef` value should match the key name in the Kubernetes secret.

### 3. Configuring the Git Service

Update your Helm values to include the credentials secrets:

```yaml
git:
  enabled: true
  verbosity: "INFO"
  credentialsSecrets:
    - my-git-credentials
    - other-git-credentials
```

This will mount the specified secrets in the Git service pod at `/git-secrets`, making them available for authentication.

#### How Kubernetes Mounts Secrets

When you specify secrets in the `credentialsSecrets` list, Kubernetes will:

1. Create a volume containing all the specified secrets
2. Mount this volume at `/git-secrets` in the Git service container
3. Each key in each secret will be available as a file in this directory

For example, if you have a secret named `my-git-credentials` with a key `github-credentials`, it will be available at:

```
/git-secrets/github-credentials
```

This is why the `secretRef` in your repository configuration should match the key name in the secret, not the secret name itself.

## Security Considerations

- Credentials are stored in Kubernetes secrets, which are base64-encoded but not encrypted
- The Git service caches credentials in memory to avoid frequent secret reads
- Credentials are cleared from the cache if authentication fails

## Troubleshooting

If you encounter authentication issues:

1. Check the Git service logs for authentication errors:
   ```bash
   kubectl logs deployment/git -n <namespace>
   ```

2. Verify that the secret is correctly mounted in the pod:
   ```bash
   kubectl exec -it deployment/git -n <namespace> -- ls -la /git-secrets
   ```

3. Check the content of the mounted secrets (don't do this in production environments):
   ```bash
   kubectl exec -it deployment/git -n <namespace> -- cat /git-secrets/<secret-key>
   ```

4. Ensure the credentials have the necessary permissions for the external repository

5. Check that the `secretRef` in the repository configuration matches the key in the secret

### Common Issues

#### Secret Not Found

If you see a log message like "Secret not found: github-credentials", check:

- The secret exists in the namespace
- The secret is included in the `git.credentialsSecrets` list in your Helm values
- The key name in the secret matches the `secretRef` in your repository configuration

#### Authentication Failures

If authentication fails, check:

- The credentials are correct and have access to the repository
- For GitHub tokens, make sure you're using the format:
  ```json
  {
    "username": "oauth2",
    "password": "<token>"
  }
  ```

#### Pod Startup Failures

If the pod fails to start with mount errors:

- Check if there are any conflicts with other volume mounts
- Verify that the Kubernetes version supports the volume configuration
- Check if the secret exists before the pod starts

## Example: Creating a Repository with GitHub Authentication

Here's a complete example of setting up a Git repository with GitHub authentication:

1. Create a secret with GitHub credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-credentials
  namespace: amrc-connectivity-stack
type: Opaque
stringData:
  github-token: |
    {
      "username": "oauth2",
      "password": "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    }
```

2. Update Helm values to include the secret:

```yaml
git:
  enabled: true
  verbosity: "INFO"
  credentialsSecrets:
    - github-credentials
```

3. Create a Git repository configuration:

```javascript
const uuid = await fplus.ConfigDB.create_object(UUIDs.Class.Repo);
await fplus.ConfigDB.put_config(Git.App.Config, uuid, {
  path: "shared/github-repo",
  pull: {
    main: {
      url: "https://github.com/myorg/private-repo.git",
      ref: "main",
      interval: "1h",
      auth: {
        secretRef: "github-token"
      }
    }
  }
});
```

This will create a Git repository that automatically pulls from the private GitHub repository using the provided token.
