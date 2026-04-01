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
