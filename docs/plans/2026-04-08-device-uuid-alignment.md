# Device UUID Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Align ConfigDB Sparkplug Device object UUIDs with their Sparkplug Instance_UUIDs so the Data Access service can reliably query InfluxDB historical data by device identity.

**Architecture:** Three coordinated changes: a Helm pre-upgrade backup hook (runs first, provides rollback point), a ConfigDB SQL migration (aligns existing devices), and an Admin UI fix (aligns new devices going forward). The ConfigDB UUID moves to match the Instance_UUID, not the reverse, because InfluxDB data is already tagged with Instance_UUID.

**Tech Stack:** Vue 3, Helm, Kubernetes Jobs, PostgreSQL/PL/pgSQL, `pg_dump`

**Key UUIDs (do not guess — use these):**
- `Class.Device` (Sparkplug Device class): `18773d6d-a70d-443a-b29a-3f1583195290`
- `App.DeviceInformation`: `a98ffed5-c613-4e70-bfd3-efeee250ade5`

---

## Task 1: Helm pre-upgrade backup hook — values.yaml entries

**Files:**
- Modify: `deploy/values.yaml:105-111`

**Step 1: Add backup config under `configdb:`**

Add the following after `bodyLimit: 100kb` in the `configdb:` section:

```yaml
configdb:
  enabled: true
  image:
    repository: acs-configdb
  bodyLimit: 100kb
  backup:
    # -- Whether to run a pg_dump of the ConfigDB before every helm upgrade
    enabled: true
    # -- Number of backups to retain
    retention: 5
    # -- Size of the PVC for storing backups
    storageSize: 2Gi
```

**Step 2: Commit**

```bash
git add deploy/values.yaml
git commit -m "configdb: add backup config values"
```

---

## Task 2: Helm pre-upgrade backup hook — Kubernetes resources

**Files:**
- Create: `deploy/templates/hooks/pre-upgrade-backup.yaml`

**Context:** The existing hook at `deploy/templates/hooks/post-delete.yaml` is the pattern to follow. The ConfigDB `db-init` init container (see `deploy/templates/configdb/configdb.yaml:48-69`) shows how to authenticate to postgres using `k5start` with the `op1pgadmin` keytab. The backup hook must use the same approach because postgres uses Kerberos auth.

**Step 1: Create the hook template**

```yaml
{{- if and .Values.configdb.enabled .Values.configdb.backup.enabled }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: configdb-backups
  namespace: {{ .Release.Namespace }}
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "-10"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: {{ .Values.configdb.backup.storageSize }}

---
apiVersion: batch/v1
kind: Job
metadata:
  name: configdb-pre-upgrade-backup
  namespace: {{ .Release.Namespace }}
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      volumes:
        - name: krb5-conf
          configMap:
            name: krb5-conf
        - name: krb5-keytabs-dbinit
          secret:
            secretName: krb5-keytabs
            items:
              - path: dbadmin
                key: op1pgadmin
        - name: backups
          persistentVolumeClaim:
            claimName: configdb-backups
      containers:
        - name: pg-backup
{{ include "amrc-connectivity-stack.image" (list . .Values.configdb) | indent 10 }}
          command: ["/usr/bin/k5start", "-Uf", "/keytabs/dbadmin"]
          args:
            - /bin/sh
            - -c
            - |
              set -e
              TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
              BACKUP_FILE="/backups/configdb-backup-${TIMESTAMP}.sql"
              echo "Running pg_dump to ${BACKUP_FILE}..."
              pg_dump -h "$PGHOST" -U "$PGUSER" -d configdb -f "$BACKUP_FILE"
              echo "Backup complete."
              # Rotate: keep last N backups
              RETENTION={{ .Values.configdb.backup.retention }}
              ls -t /backups/configdb-backup-*.sql | tail -n +$((RETENTION + 1)) | xargs -r rm --
              echo "Rotation complete. Current backups:"
              ls -lh /backups/
          env:
            - name: KRB5_CONFIG
              value: /config/krb5-conf/krb5.conf
            - name: PGHOST
              value: postgres.{{ .Release.Namespace }}.svc.cluster.local
            - name: PGUSER
              value: op1pgadmin
          volumeMounts:
            - mountPath: /config/krb5-conf
              name: krb5-conf
            - mountPath: /keytabs
              name: krb5-keytabs-dbinit
            - mountPath: /backups
              name: backups
  backoffLimit: 0
{{- end }}
```

Note `backoffLimit: 0` — the hook must fail fast rather than retry, so Helm aborts the upgrade immediately on failure.

**Step 2: Verify template renders without error**

```bash
helm template deploy/ --set acs.baseUrl=test.example.com --set identity.realm=TEST.EXAMPLE.COM | grep -A5 "configdb-pre-upgrade-backup"
```

Expected: Job metadata and spec rendered with no template errors.

**Step 3: Commit**

```bash
git add deploy/templates/hooks/pre-upgrade-backup.yaml
git commit -m "helm: add pre-upgrade configdb backup hook"
```

---

## Task 3: ConfigDB SQL migration — v13.sql

**Files:**
- Create: `acs-configdb/sql/v13.sql`

**Context:** Read `acs-configdb/sql/migration.sql` to understand `migrate_to()`. Read `acs-configdb/sql/v9.sql:61-79` for `update_registration()`. Read `acs-configdb/sql/v8.sql` for the DB schema (tables: `object`, `config`, `membership`, `subclass`). The `config` table has integer FKs only — UUIDs appear as text inside `json` (jsonb) values.

The migration must:
1. Find all Sparkplug_Device objects (members of class `18773d6d-a70d-443a-b29a-3f1583195290`)
2. Extract their Instance_UUID from the DeviceInformation config (`a98ffed5-c613-4e70-bfd3-efeee250ade5`), at path `originMap -> Instance_UUID`
3. Pre-flight: if any two devices share the same Instance_UUID, raise and abort
4. For each device where Instance_UUID ≠ object.uuid: global text replace in config.json, then update object.uuid
5. Call `update_registration(null)` to rebuild Object Registration entries

**Step 1: Create v13.sql**

```sql
-- Factory+ config DB
-- DB schema v13: align Sparkplug Device UUIDs with Instance_UUIDs
-- Copyright 2026 University of Sheffield AMRC

call migrate_to(13, $$
    do $$
    declare
        -- UUIDs of the relevant class and app
        device_class_uuid uuid := '18773d6d-a70d-443a-b29a-3f1583195290';
        device_info_app_uuid uuid := 'a98ffed5-c613-4e70-bfd3-efeee250ade5';

        -- Working variables
        obj_id integer;
        obj_uuid uuid;
        instance_uuid uuid;
        duplicate_count integer;
    begin
        -- Pre-flight: check for duplicate Instance_UUIDs among Sparkplug Devices.
        -- This would cause a unique constraint violation on object.uuid if we proceeded.
        select count(*) into duplicate_count
        from (
            select c.json->>'originMap'->>'Instance_UUID' as iuuid
            from config c
            join object app_obj on app_obj.id = c.app
                and app_obj.uuid = device_info_app_uuid
            join object dev_obj on dev_obj.id = c.object
            join all_membership m on m.id = dev_obj.id
            join object cls on cls.id = m.class
                and cls.uuid = device_class_uuid
            where c.json->'originMap' ? 'Instance_UUID'
                and c.json->>'originMap'->>'Instance_UUID' is not null
            group by iuuid
            having count(*) > 1
        ) dupes;

        if duplicate_count > 0 then
            raise exception
                'UUID alignment migration aborted: % device(s) share a duplicate Instance_UUID. '
                'Resolve conflicts in the admin UI before re-running.',
                duplicate_count;
        end if;

        -- For each Sparkplug Device with an Instance_UUID that differs from its object UUID:
        for obj_id, obj_uuid, instance_uuid in
            select dev_obj.id, dev_obj.uuid,
                   (c.json->'originMap'->>'Instance_UUID')::uuid
            from config c
            join object app_obj on app_obj.id = c.app
                and app_obj.uuid = device_info_app_uuid
            join object dev_obj on dev_obj.id = c.object
            join all_membership m on m.id = dev_obj.id
            join object cls on cls.id = m.class
                and cls.uuid = device_class_uuid
            where c.json->'originMap' ? 'Instance_UUID'
                and (c.json->'originMap'->>'Instance_UUID')::uuid != dev_obj.uuid
        loop
            raise notice 'Aligning device %: % -> %', obj_id, obj_uuid, instance_uuid;

            -- Global text replace: every reference to the old UUID in any config value.
            update config
            set json = replace(json::text, obj_uuid::text, instance_uuid::text)::jsonb
            where json::text like '%' || obj_uuid::text || '%';

            -- Update the object's UUID itself.
            update object set uuid = instance_uuid where id = obj_id;
        end loop;

        -- Rebuild Object Registration entries to reflect updated UUIDs.
        call update_registration(null);

        raise notice 'Device UUID alignment migration complete.';
    end;
    $$;
$$);
```

**Step 2: Commit**

```bash
git add acs-configdb/sql/v13.sql
git commit -m "configdb: add v13 migration to align Device UUIDs with Instance_UUIDs"
```

---

## Task 4: Wire v13 into migrate.sql

**Files:**
- Modify: `acs-configdb/sql/migrate.sql`

**Step 1: Add v13 include**

In `migrate.sql`, after `\ir v11.sql` (before `\ir grant.sql`), add:

```sql
\ir v12.sql
\ir v13.sql
```

Note: `v12.sql` is not currently wired in either — check whether it should be. If `v12.sql` already exists and is a valid migration, add it too. If it's a work-in-progress, just add `v13.sql`.

**Step 2: Verify migrate.sql runs cleanly against a local postgres**

If you have a local postgres available:
```bash
cd acs-configdb
SRV_DATABASE=configdb_test SRV_USER=test psql postgres -f sql/migrate.sql
```

Otherwise, the migration will be validated as part of the ConfigDB pod startup during a real deploy. The `migrate_to()` procedure is idempotent — re-running a migration at the current version is a no-op.

**Step 3: Commit**

```bash
git add acs-configdb/sql/migrate.sql
git commit -m "configdb: wire v13 migration into migrate.sql"
```

---

## Task 5: Admin UI — use ConfigDB UUID as Instance_UUID

**Files:**
- Modify: `acs-admin/src/components/EdgeManager/Devices/OriginMapEditor/OriginMapEditor.vue:851-860`

**Context:** `this.device.uuid` is the ConfigDB object UUID for the device, already in scope (see line 978 where it is passed to `patch_config`). The goal is to always set the top-level Instance_UUID to this value rather than generating a random UUIDv4. The `uuidv4` import can be removed from this file if it is no longer used elsewhere — check before removing.

**Step 1: Update `prepareModelForSaving()`**

Replace lines 856-859:

```js
// Before
// Set the top level Instance_UUID if it doesn't already exist
if (!this.model.Instance_UUID) {
  this.set('Instance_UUID', uuidv4(), this.model)
}
```

With:

```js
// After
// Set the top level Instance_UUID to the ConfigDB object UUID.
// This ensures the Instance_UUID is stable across schema changes and
// matches the device's identity in ConfigDB.
this.set('Instance_UUID', this.device.uuid, this.model)
```

**Step 2: Check if `uuidv4` is still used elsewhere in the file**

```bash
grep -n "uuidv4" acs-admin/src/components/EdgeManager/Devices/OriginMapEditor/OriginMapEditor.vue
```

If `uuidv4` only appeared in the now-removed call, remove its import. If it appears at lines 643, 736 (sub-Instance_UUID generation for nested objects), leave the import in place.

**Step 3: Manually test in the UI**

1. Create a new device, select a schema, save the origin map. Verify the Instance_UUID in the saved config matches the device's ConfigDB UUID.
2. Change the device's schema, reconfigure, save again. Verify the Instance_UUID is unchanged.

**Step 4: Commit**

```bash
git add acs-admin/src/components/EdgeManager/Devices/OriginMapEditor/OriginMapEditor.vue
git commit -m "admin: use ConfigDB object UUID as device Instance_UUID"
```

---

## Testing & Rollback Notes

**To test the migration pre-flight check:** Manually set two devices to the same Instance_UUID directly in postgres, then run `helm upgrade`. The migration should abort with a clear error message, leaving the DB unchanged.

**To test backup rotation:** Run `helm upgrade` 6+ times and verify only 5 backups remain in the PVC.

**Rollback:** If the migration fails, the transaction rolls back and the ConfigDB version number stays at v12. The pre-upgrade backup is available at `/backups/configdb-backup-<timestamp>.sql` in the `configdb-backups` PVC. Restore with `pg_restore` or `psql` using the `op1pgadmin` credentials.
