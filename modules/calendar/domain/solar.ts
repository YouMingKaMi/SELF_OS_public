const dayMs = 86_400_000;

/** Find the occurrence on or after a date, preserving the original day of month. */
export function solarOccurrence(base: string, from: string, unit: string, interval: number): string | null {
  const first = new Date(base + "T00:00:00Z");
  const after = new Date(from + "T00:00:00Z");
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(after.getTime()) ||
      !Number.isSafeInteger(interval) || interval < 1) return null;
  if (first >= after) return base;

  if (unit === "day" || unit === "week") {
    const step = dayMs * interval * (unit === "week" ? 7 : 1);
    return dateString(new Date(first.getTime() + Math.ceil((after.getTime() - first.getTime()) / step) * step));
  }
  if (unit !== "month" && unit !== "year") return null;
  const months = (after.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    after.getUTCMonth() - first.getUTCMonth();
  const step = interval * (unit === "year" ? 12 : 1);
  const jumps = Math.floor(months / step);
  function candidate(count: number) {
    const next = new Date(first);
    next.setUTCDate(1);
    next.setUTCMonth(first.getUTCMonth() + count * step);
    const end = new Date(next);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    next.setUTCDate(Math.min(first.getUTCDate(), end.getUTCDate()));
    return next;
  }
  const next = candidate(jumps);
  return dateString(next >= after ? next : candidate(jumps + 1));
}

function dateString(date: Date): string | null {
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10) : null;
}
