# ConfigDB Backup & Restore Playbook

## Automated Backups

From version 5.0.5 onwards, a `pg_dump` runs automatically before every
`helm upgrade` via a pre-upgrade hook. Backups are stored in the
`configdb-backups` PVC and rotated to keep the last 5.

**First upgrade to 5.0.5:** The backup PVC does not exist yet, so the
automatic backup is skipped. It is advised that you run a manual backup
before upgrading (see below).

## Manual Backup

```bash
# Dump the database inside the postgres pod
kubectl exec -n factory-plus postgres-1-0 -- \
  su - postgres -c "pg_dump configdb > /tmp/configdb-backup.sql"

# Copy the backup to your local machine
kubectl cp factory-plus/postgres-1-0:/tmp/configdb-backup.sql \
  ./configdb-backup-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql

# Clean up the file in the pod
kubectl exec -n factory-plus postgres-1-0 -- rm /tmp/configdb-backup.sql
```

## Restore

### From a backup file

```bash
# Copy the backup into the postgres pod
kubectl cp configdb-backup-YYYY-MM-DDTHH-MM-SSZ.sql \
  factory-plus/postgres-1-0:/tmp/restore.sql

# Exec into the pod
kubectl exec -it -n factory-plus postgres-1-0 -- su - postgres

# Inside the pod: drop and recreate the database
psql <<EOF
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'configdb' AND pid <> pg_backend_pid();

DROP DATABASE configdb;
CREATE DATABASE configdb;
EOF

# Restore
psql -d configdb -f /tmp/restore.sql

# Clean up
rm /tmp/restore.sql
```

After restoring, restart the ConfigDB pod to pick up the restored data:

```bash
kubectl rollout restart deployment/configdb -n factory-plus
```

### From the automated backup PVC

Mount the backup PVC in a temporary pod to access previous backups:

```bash
kubectl run backup-reader --rm -it \
  --image=busybox \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "backup-reader",
        "image": "busybox",
        "command": ["sh"],
        "stdin": true,
        "tty": true,
        "volumeMounts": [{
          "name": "backups",
          "mountPath": "/backups"
        }]
      }],
      "volumes": [{
        "name": "backups",
        "persistentVolumeClaim": {
          "claimName": "configdb-backups"
        }
      }]
    }
  }' \
  -n factory-plus

# Inside the pod
ls -lh /backups/
```

Copy the desired backup out with `kubectl cp` and follow the restore
steps above.
