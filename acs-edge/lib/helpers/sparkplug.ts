import { sparkplugMetric } from "./typeHandler.js";

export function prefixMetrics (
    metrics: sparkplugMetric[], prefix: string) : sparkplugMetric[]
{
    return metrics.map(m => ({ ...m, name: `${prefix}/${m.name}` }));
}
