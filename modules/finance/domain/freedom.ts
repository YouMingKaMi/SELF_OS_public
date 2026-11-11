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
  if (!(input.average > 0)) return { days: null, blue: 0, gold: 0, volatile: 0 };
  const assets = input.assets > 0n ? input.assets : 0n;
  const days = Math.floor(Number(assets) / input.average);
  const base = input.startAssets < assets ? (input.startAssets > 0n ? input.startAssets : 0n) : assets;
  const blue = Math.min(days, Math.floor(Number(base) / input.average));
  const extra = input.volatile && input.volatile > 0n ? input.volatile : 0n;
  const withVolatile = Math.floor(Number(assets + extra) / input.average);
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
