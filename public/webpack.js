/*
 * Factory+ visualiser.
 * Webpack import ESM shim.
 * Copyright 2022 AMRC.
 */

const webpack = await AMRC_FactoryPlus_Vis;

export const { EventEmitter, FactoryPlus } = webpack;
export const { Address, Topic, MQTT, SpB } = FactoryPlus;
