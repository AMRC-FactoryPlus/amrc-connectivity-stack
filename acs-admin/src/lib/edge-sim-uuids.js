/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Well-known UUIDs for the simulator driver (edge-sim). These must
 * match acs-service-setup/lib/uuids.js (ACS.Driver.Sim, EdgeSim.*)
 * and edge-sim/lib/uuids.js.
 */

export const EdgeSim = {
  /* The Simulator entry in the Manager's driver catalogue. */
  Driver: 'da866ba6-cd0e-491b-a780-19466723b23f',
  /* ConfigDB class cassette objects belong to. */
  CassetteClass: '64139528-3dbf-4b34-afb5-3a71fc1c4f3b',
  /* ConfigDB Application holding cassette recordings. */
  CassetteApp: '844c9d80-97ab-4ffc-918c-f4e529411108',
}

/* The transport metrics of the Player_Controls schema, as mounted in a
 * device schema. Command values ride DCMDs through cmdesc. */
export const PlayerMetric = {
  Load: 'Player_Controls/Load',
  Play: 'Player_Controls/Play',
  Pause: 'Player_Controls/Pause',
  Stop: 'Player_Controls/Stop',
  Eject: 'Player_Controls/Eject',
  Seek: 'Player_Controls/Seek',
  Rate: 'Player_Controls/Rate',
  /* Read-only state published by the driver */
  Status: 'Player_Controls/Status',
  Cassette: 'Player_Controls/Cassette',
  Position: 'Player_Controls/Position',
  RateActual: 'Player_Controls/Rate_Actual',
  Error: 'Player_Controls/Error',
}

export const DECK_RATES = [1, 2, 5, 10, 25, 50, 100]
