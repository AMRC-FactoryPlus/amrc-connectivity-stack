# i3X Service — To-Improve Document (TID)

Tracked deviations from the i3X spec and known areas for improvement.

## Spec Deviations

| ID | Area | Deviation                                                | Reason                                                                                    | Resolution path                                              |
|----|------|----------------------------------------------------------|-------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| D1 | Auth | Using HTTP Basic Auth instead of API keys (MUST in spec) | PoC simplicity — Basic Auth maps directly to Factory+ username/password via ServiceClient | Implement API key / Bearer token auth with principal mapping |

## Known Limitations to Improve

| ID | Area                        | Current behaviour                                                                              | Ideal behaviour                                                                                | Notes                                                                         |
|----|-----------------------------|------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| L1 | Device discovery            | Re-poll ConfigDB/Directory every 60s to detect new devices                                     | Use Directory's PostgreSQL LISTEN/NOTIFY or MQTT `Last_Changed/*` events for real-time updates | Directory already has the mechanism (sql/v7.sql triggers, mqttcli.js:437-445) |
| L2 | ObjectTypes without schemas | Return empty `{"type": "object"}` schema for ConfigDB classes missing a ConfigSchema app entry | Either require schemas or synthesise from Sparkplug birth certificate structure                | Most real devices will have schemas; this is an edge case                     |
| L3 | SSE streaming scope | SSE subscriptions only stream values from devices publishing to UNS (requires UNS ingester + ISA-95 config) | Stream from all devices, including those only on Sparkplug | Could subscribe to `spBv1.0/#` directly, or use the historian's Sparkplug data. Needs design work — Sparkplug uses protobuf + aliases which requires birth certificate tracking |
| L4 | Device identity | Device elementId uses ConfigDB UUID, sub-objects use Instance_UUID. Ideally these would be consistent | Use Instance_UUID throughout, or provide a mapping endpoint | Too late to change for PoC without breaking the parent chain from ConfigDB |
