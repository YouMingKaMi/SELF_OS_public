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
  let total = 0;
  let active: Interval | undefined;
  for (const { start, end } of sorted) {
    if (!active || start > active.end) {
      if (active) total += active.end - active.start;
      active = { start, end };
    } else active.end = Math.max(active.end, end);
  }
  return (total + (active ? active.end - active.start : 0)) / 1000;
}
function sessionTime(session: TimeSession, now: number) {
  const d = session.data;
  const ranges: Interval[] = [];
  const elapsed = Number(d.elapsedSeconds);
  const recorded = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (d.status === "cancelled")
    return { ranges, total: 0, manual: 0, unlocated: 0 };
  if (d.manual)
    return { ranges, total: recorded, manual: recorded, unlocated: 0 };
  for (const segment of (d.segments as string[]) ?? []) {
    const [start, end] = segment.split("/").map(Date.parse);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      ranges.push({ start, end });
  }
  // Old sessions can have frozen duration without corresponding closed segments.
  // Keep that remainder on the recorded business day without inventing a time interval.
  const closed =
    ranges.reduce((sum, range) => sum + (range.end - range.start), 0) / 1000;
  const remainder = recorded - closed;
  const unlocated = remainder > 0.001 ? remainder : 0;
  let running = 0;
  if (d.status === "running" && typeof d.runningSince === "string") {
    const start = Date.parse(d.runningSince);
    if (Number.isFinite(start) && Number.isFinite(now) && now > start) {
      ranges.push({ start, end: now });
      running = (now - start) / 1000;
    }
  }
  return { ranges, total: closed + unlocated + running, manual: 0, unlocated };
}
export function intervalsFor(session: TimeSession, now: number): Interval[] {
  return sessionTime(session, now).ranges;
}
export function sessionElapsedSeconds(
  session: TimeSession,
  now: number,
): number {
  return sessionTime(session, now).total;
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
  const untimed = new Map<string, number>();
  let manualSeconds = 0;
  let unlocatedSeconds = 0;
  for (const session of sessions) {
    const { ranges, manual, unlocated } = sessionTime(session, now);
    if (manual + unlocated > 0) {
      const date = String(session.data.day ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        untimed.set(date, (untimed.get(date) ?? 0) + manual + unlocated);
        manualSeconds += manual;
        unlocatedSeconds += unlocated;
      }
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
  for (const date of new Set([...buckets.keys(), ...untimed.keys()])) {
    const ranges = buckets.get(date) ?? [];
    const seconds = unionSeconds(ranges);
    overlapSeconds +=
      ranges.reduce((sum, i) => sum + (i.end - i.start) / 1000, 0) - seconds;
    daily[date] = seconds + (untimed.get(date) ?? 0);
  }
  return {
    daily,
    totalSeconds: Object.values(daily).reduce((a, b) => a + b, 0),
    overlapSeconds,
    manualSeconds,
    unlocatedSeconds,
  };
}
