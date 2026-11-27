import type { AnyEntity } from "../../packages/contracts/entities.ts";

/** One numeric sample per metric-day. Keep all candidates for review when values disagree. */
export function metricDays(logs: readonly AnyEntity[]) {
  const grouped = new Map<string, Map<string, AnyEntity[]>>();
  for (const log of logs) {
    if (log.deleted || log.type !== "metricLog") continue;
    const { metricId, day } = log.data;
    if (typeof metricId !== "string" || typeof day !== "string") continue;
    let days = grouped.get(metricId);
    if (!days) grouped.set(metricId, (days = new Map()));
    const rows = days.get(day);
    if (rows) rows.push(log);
    else days.set(day, [log]);
  }
  return new Map([...grouped].map(([metricId, days]) => [metricId, new Map(
    [...days].map(([day, candidates]) => {
      const values = new Set(candidates.flatMap(({ data }) =>
        typeof data.value === "number" && Number.isFinite(data.value) ? [data.value] : [],
      ));
      const value = values.size === 1 ? values.values().next().value! : null;
      return [day, { value, candidates, conflict: values.size > 1 }] as const;
    }),
  )] as const));
}
