/**
 * 自由指南灯: how many days of life the assets in hand already pay for.
 *   daily cost  = usage cost of every day from the bookkeeping start to today ÷ those days
 *   free days   = assets ÷ daily cost
 * A day's usage cost is what was paid that day for ordinary spending, plus that day's share of every
 * long-term item in use — including items bought before the start, which contribute only their share.
 * The share is either "current" (price ÷ days used so far: a new purchase weighs heavily, then fades)
 * or "term" (price ÷ expected lifetime: the steady-state cost). Unrecorded days count as zero.
 * Income is not tracked. All amounts are CNY cents; averages are floats because this is a projection.
 */
import { daily, dayCount, effectiveEnd, net } from "./ledger.ts";

type Row = { data: Record<string, unknown> };
const text = (row: Row, key: string) => String(row.data[key] ?? "");
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export type CostBasis = "current" | "term";
export type DailyCost = {
  /** Bookkeeping start actually used, or null when nothing is recorded yet. */
  since: string | null;
  days: number;
  /** Usage cost of the whole period, in cents. */
  total: number;
  /** Cents per day. */
  average: number;
  /** Today's usage cost, in cents. */
  today: number;
};

/** Where daily bookkeeping began: the first ordinary (non long-term) expense. */
export function bookkeepingStart(expenses: Row[], today: string): string | null {
  let first: string | null = null;
  for (const e of expenses) {
    const day = text(e, "day");
    if (e.data.mode !== "immediate" && e.data.mode !== undefined) continue;
    if (isDay(day) && day <= today && (first === null || day < first)) first = day;
  }
  return first;
}

export function dailyCost(
  expenses: Row[],
  today: string,
  options: { since?: string | null; basis?: CostBasis } = {},
): DailyCost {
  const since = options.since && isDay(options.since) ? options.since : bookkeepingStart(expenses, today);
  if (!since || since > today) return { since: null, days: 0, total: 0, average: 0, today: 0 };
  const current = (options.basis ?? "current") === "current";
  let total = 0;
  let onToday = 0;
  for (const e of expenses) {
    if (e.data.mode === "immediate" || e.data.mode === undefined) {
      const day = text(e, "day");
      if (!isDay(day) || day < since || day > today) continue;
      total += Number(net(e));
      if (day === today) onToday += Number(net(e));
      continue;
    }
    const rate = daily(e, today, current);
    const start = text(e, "startDay");
    if (!rate || !isDay(start)) continue;
    const end = effectiveEnd(e, today);
    // An item still in use past its expected life: spread the price over the days actually used,
    // otherwise the term share would keep charging and the total would exceed what was paid.
    const used = dayCount(start, end < today ? end : today);
    const overdue = !current && e.data.mode !== "fixed" && !e.data.endedDay && used > Number(rate.d);
    const perDay = overdue ? Number(rate.n) / used : Number(rate.n) / Number(rate.d);
    const from = start > since ? start : since;
    const to = end < today ? end : today;
    if (from > to) continue;
    total += perDay * dayCount(from, to);
    if (to === today) onToday += perDay;
  }
  const days = dayCount(since, today);
  return { since, days, total, average: total / days, today: onToday };
}

export type Freedom = {
  /** Whole days the assets cover at the current daily cost; null when there is no daily cost yet. */
  days: number | null;
  /** Days lit by assets held at the starting point. */
  blue: number;
  /** Days lit by what the assets have grown since. */
  gold: number;
  /** Extra days that only volatile assets (crypto, stocks…) would add; never part of `days`. */
  volatile: number;
};

/** `assets` are the stable ones: money in hand. Volatile assets are shown apart and promise nothing. */
export function freedom(input: { assets: bigint; startAssets: bigint; average: number; volatile?: bigint }): Freedom {
  if (!(input.average > 0) || !Number.isFinite(input.average)) return { days: null, blue: 0, gold: 0, volatile: 0 };
  const assets = input.assets > 0n ? input.assets : 0n;
  const daysFor = (amount: bigint) => Math.min(1_000_000, Math.floor(Number(amount) / input.average));
  const days = daysFor(assets);
  const base = input.startAssets < assets ? (input.startAssets > 0n ? input.startAssets : 0n) : assets;
  const blue = Math.min(days, daysFor(base));
  const extra = input.volatile && input.volatile > 0n ? input.volatile : 0n;
  const withVolatile = daysFor(assets + extra);
  return { days, blue, gold: days - blue, volatile: withVolatile - days };
}

/**
 * What one more event today would do. Spending lowers the assets only if it comes out of them
 * (`fromAssets`), but it always raises the daily cost — the standard every remaining day is priced at.
 * Income raises the assets once and leaves the daily cost alone. That asymmetry is the point.
 */
export function whatIf(
  cost: DailyCost,
  assets: bigint,
  change: { spend?: bigint; income?: bigint; fromAssets?: boolean },
): { days: number | null; average: number } {
  const spend = change.spend ?? 0n;
  const days = Math.max(cost.days, 1);
  // An ordinary purchase made today, paid in full.
  const average = (cost.total + Number(spend)) / days;
  const after = assets + (change.income ?? 0n) - (change.fromAssets ? spend : 0n);
  return { days: freedom({ assets: after, startAssets: after, average }).days, average };
}

export type FreedomTrendPoint = {
  day: string;
  average: number | null;
  usageCost: number | null;
  days: number | null;
};
const dayMillis = 86_400_000;
const businessZone = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai", timeZoneName: "longOffset",
});

/** Exclusive close of the accounting day at the next Shanghai midnight. */
export function businessDayEnd(day: string): number {
  const next = Date.parse(day + "T00:00:00Z") + dayMillis;
  if (!Number.isFinite(next)) return NaN;
  const offset = businessZone.formatToParts(next - 8 * 3_600_000)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset ?? "");
  if (!match) return next - 8 * 3_600_000;
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0);
  return next - (match[1] === "+" ? seconds : -seconds) * 1000;
}

/** Hide a sale or recovery that had not yet occurred on a retrospective point. */
export function expenseKnownAt(row: Row, day: string): Row {
  const ended = text(row, "endedDay");
  const recovery = text(row, "recoveryDay") || ended || text(row, "day");
  if (ended <= day && recovery <= day) return row;
  return { data: { ...row.data, endedDay: ended > day ? "" : ended, recoveryMinor: recovery > day ? "0" : row.data.recoveryMinor } };
}

/** Date range only controls the view. Each average still starts at the bookkeeping start. */
export function freedomTrend(
  expenses: Row[],
  history: readonly { at: string; value: bigint | null }[],
  options: { from: string; to: string; today: string; assetsToday: bigint | null; since?: string; basis: CostBasis },
): FreedomTrendPoint[] {
  const end = options.to < options.today ? options.to : options.today;
  const first = Date.parse(options.from + "T00:00:00Z");
  const last = Date.parse(end + "T00:00:00Z");
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  const stride = Math.max(1, Math.ceil((last - first) / dayMillis / 366));
  const points: FreedomTrendPoint[] = [];
  const timed = history.map((row) => ({ ...row, time: Date.parse(row.at) }))
    .filter((row) => Number.isFinite(row.time)).sort((a, b) => a.time - b.time);
  const since = options.since && isDay(options.since) ? options.since : bookkeepingStart(expenses, end);
  const ordinaryByDay = new Map<string, bigint>();
  const ordinaryEvents = new Map<string, bigint>();
  const longTerm: Row[] = [];
  const increment = (map: Map<string, bigint>, day: string, amount: bigint) =>
    map.set(day, (map.get(day) ?? 0n) + amount);
  for (const row of expenses) {
    if (row.data.mode !== "immediate" && row.data.mode !== undefined) {
      longTerm.push(row);
      continue;
    }
    const purchase = text(row, "day");
    if (!since || !isDay(purchase) || purchase < since || purchase > end) continue;
    const amount = BigInt(text(row, "amountMinor") || "0");
    const recovery = BigInt(text(row, "recoveryMinor") || "0");
    increment(ordinaryEvents, purchase, amount);
    increment(ordinaryByDay, purchase, amount);
    if (recovery === 0n) continue;
    const recoveredAt = text(row, "recoveryDay") || text(row, "endedDay") || purchase;
    const firstKnown = recoveredAt < purchase ? purchase : recoveredAt;
    // Today shows the purchase using the current ledger; older points only use events then known.
    const effective = firstKnown > options.today ? options.today : firstKnown;
    increment(ordinaryEvents, effective, -recovery);
    if (effective === purchase) increment(ordinaryByDay, purchase, -recovery);
  }
  const events = [...ordinaryEvents].sort(([left], [right]) => left.localeCompare(right));
  let eventIndex = 0;
  let ordinaryTotal = 0n;
  let cursor = 0;
  let balance: bigint | null = null;
  for (let at = first; ; at = Math.min(last, at + stride * dayMillis)) {
    const day = new Date(at).toISOString().slice(0, 10);
    // Accounting days close at midnight UTC+8. A future price cannot fill an earlier gap.
    const nextMidnight = businessDayEnd(day);
    while (cursor < timed.length && timed[cursor].time < nextMidnight) balance = timed[cursor++].value;
    while (eventIndex < events.length && events[eventIndex][0] <= day) ordinaryTotal += events[eventIndex++][1];

    const assets = day === options.today ? options.assetsToday : balance;
    if (!since || day < since) {
      points.push({ day, average: null, usageCost: null, days: null });
    } else {
      const rows = day === options.today ? longTerm : longTerm.map((row) => expenseKnownAt(row, day));
      const cost = dailyCost(rows, day, { since, basis: options.basis });
      const average = (Number(ordinaryTotal) + cost.total) / cost.days;
      points.push({
        day,
        average,
        usageCost: Number(ordinaryByDay.get(day) ?? 0n) + cost.today,
        days: assets === null ? null : freedom({ assets, startAssets: 0n, average }).days,
      });
    }
    if (at === last) return points;
  }
}
