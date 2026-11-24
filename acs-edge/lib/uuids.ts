/* ACS Edge Agent
 * Well-known UUIDs
 * Copyright 2023 AMRC
 */

export const Special = {
    FactoryPlus:    "11ad7b32-1d32-4c4a-b0c9-fa049208939a",
    Null:           "00000000-0000-0000-0000-000000000000",
    V5Metric:       "8a4dc2f4-2f9f-45fc-b2e9-ed7b9cda6145",
};
export const App = {
    AgentConfig:      "aac6f843-cfee-4683-b121-6943bfdf9173",
    /* edge-sim cassettes; must match acs-service-setup EdgeSim.App */
    Cassette:         "844c9d80-97ab-4ffc-918c-f4e529411108",
    /* Edge Scout status, one entry per connection; must match
     * acs-service-setup Edge.App.ScoutStatus */
    ScoutStatus:      "ad73fae4-a3b9-457a-8c36-12a2019bff2c",
};
export const Class = {
    /* An Edge Scout snapshot File object; Edge.Class.ScoutResult */
    ScoutResult:      "10916e96-f6fe-44cc-8c01-16a775426038",
};
export const Perm = {
    /* "Scan device addresses", the CmdEsc permission for
     * Node Control/Scout; Edge.Perm.Scout */
    Scout:            "41443382-ecad-439b-999f-cb611bc11f7c",
};
export const Service = {
    /* Drivers' file requests are fetched from here */
    Files:          "a2a6efc5-9793-4486-9fd9-7caf9e3b5451",
};
export const Schema = {
    EdgeAgent:      "15360868-2f35-4b52-990b-49329fb246fe",
    Alert:          "8853aa15-2228-4309-b98e-e086cefbc72c",
};
export const Alert = {
    ConfigFetchFailed:  "c414c68b-5014-4e46-a0b4-d5f7f8df1d9f",
    ConfigInvalid:      "99c54cb2-2bb9-45c8-88f9-c1a0f792cfd6",
    Connection:         "633a7da3-ea2a-4e3f-8e84-35691a07465f",
};