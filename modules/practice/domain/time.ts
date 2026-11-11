/** Time intervals use explicit ISO instants; the caller supplies now and business timezone. */
export type Interval = { start: number; end: number };
export type TimeSession = { id: string; data: Record<string, unknown> };
export function unionSeconds(intervals: Interval[]): number {
  const sorted = intervals
    .filter(
      (i) =>
        Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start,
    )
    .sort((a, b) => a.start - b.start);
  let total = 0,
    start = 0,
    end = 0;
  for (const value of sorted) {
    if (value.start > end) {
      total += Math.max(0, end - start);
      start = value.start;
      end = value.end;
    } else end = Math.max(end, value.end);
  }
  return (total + Math.max(0, end - start)) / 1000;
}
export function intervalsFor(session: TimeSession, now: number): Interval[] {
  const d = session.data;
  if (d.status === "cancelled" || d.manual) return [];
  const result: Interval[] = [];
  for (const segment of (d.segments as string[]) ?? []) {
    const [start, end] = segment.split("/").map(Date.parse);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      result.push({ start, end });
  }
  if (d.status === "running" && typeof d.runningSince === "string") {
    const start = Date.parse(d.runningSince);
    if (Number.isFinite(start) && now > start) result.push({ start, end: now });
  }
  // Compatibility for early synthetic/imported records which contain duration but no segments.
  if (
    !result.length &&
    typeof d.startedAt === "string" &&
    Number(d.elapsedSeconds) > 0
  ) {
    const start = Date.parse(d.startedAt);
    if (Number.isFinite(start))
      result.push({ start, end: start + Number(d.elapsedSeconds) * 1000 });
  }
  return result;
}
export function timeSummary(
  sessions: TimeSession[],
  now: number,
  timezone = "Asia/Shanghai",
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = (at: number) => formatter.format(new Date(at));
  const buckets = new Map<string, Interval[]>();
  const manual = new Map<string, number>();
  for (const session of sessions) {
    if (session.data.status === "cancelled") continue;
    const ranges = intervalsFor(session, now);
    if (!ranges.length) {
      const date = String(session.data.day ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date))
        manual.set(
          date,
          (manual.get(date) ?? 0) +
            Math.max(0, Number(session.data.elapsedSeconds) || 0),
        );
    }
    for (const range of ranges) {
      let cursor = range.start;
      while (cursor < range.end) {
        const date = day(cursor);
        let boundary = range.end;
        if (day(range.end - 1) !== date) {
          let lo = cursor,
            hi = Math.min(range.end, cursor + 36 * 3600000);
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (day(mid) === date) lo = mid;
            else hi = mid;
          }
          boundary = hi;
        }
        const values = buckets.get(date) ?? [];
        values.push({ start: cursor, end: boundary });
        buckets.set(date, values);
        cursor = boundary;
      }
    }
  }
  const daily: Record<string, number> = {};
  let overlapSeconds = 0;
  for (const date of new Set([...buckets.keys(), ...manual.keys()])) {
    const ranges = buckets.get(date) ?? [];
    const seconds = unionSeconds(ranges);
    overlapSeconds +=
      ranges.reduce((sum, i) => sum + (i.end - i.start) / 1000, 0) - seconds;
    daily[date] = seconds + (manual.get(date) ?? 0);
  }
  return {
    daily,
    totalSeconds: Object.values(daily).reduce((a, b) => a + b, 0),
    overlapSeconds,
    manualSeconds: [...manual.values()].reduce((a, b) => a + b, 0),
  };
}
