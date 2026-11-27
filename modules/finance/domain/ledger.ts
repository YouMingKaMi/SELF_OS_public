type CostEntry = { data: Record<string, unknown> };
const str = (e: CostEntry, key: string, fallback = "") =>
  String(e.data[key] ?? fallback);
export const dayCount = (start: string, end: string) =>
  Math.floor(
    (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
      86400000,
  ) + 1;
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
export type Fraction = { n: bigint; d: bigint };
export function add(a: Fraction, b: Fraction): Fraction {
  const n = a.n * b.d + b.n * a.d,
    d = a.d * b.d,
    g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export function round(a: Fraction) {
  const sign = a.n < 0n ? -1n : 1n,
    n = a.n * sign;
  return sign * ((n * 2n + a.d) / (2n * a.d));
}
export function net(e: CostEntry) {
  return (
    BigInt(str(e, "amountMinor", "0")) - BigInt(str(e, "recoveryMinor", "0"))
  );
}
export function daily(
  e: CostEntry,
  asOf: string,
  current = false,
): Fraction | null {
  if (e.data.mode === "immediate" || !e.data.startDay || !e.data.endDay)
    return null;
  const start = str(e, "startDay"),
    end = e.data.endedDay ? str(e, "endedDay") : asOf;
  if (start > asOf) return null;
  const days =
    e.data.mode === "fixed"
      ? dayCount(start, str(e, "endDay"))
      : e.data.endedDay
        ? dayCount(start, end)
        : current
          ? dayCount(start, asOf)
          : dayCount(start, str(e, "endDay"));
  return days > 0 ? { n: net(e), d: BigInt(days) } : null;
}
export function usage(
  e: CostEntry,
  day: string,
  asOf: string,
  current = false,
): Fraction {
  if (e.data.mode === "immediate")
    return day <= asOf && e.data.day === day
      ? { n: net(e), d: 1n }
      : { n: 0n, d: 1n };
  if (
    day > asOf ||
    day < str(e, "startDay") ||
    day > effectiveEnd(e, asOf)
  )
    return { n: 0n, d: 1n };
  return daily(e, asOf, current) ?? { n: 0n, d: 1n };
}
/** Last day of use as of `asOf`: a confirmed end, a fixed term's end, or today while still in use. */
export function effectiveEnd(e: CostEntry, asOf: string) {
  const confirmed = str(e, "endedDay");
  if (e.data.mode === "fixed") {
    const term = str(e, "endDay");
    return confirmed && confirmed < term ? confirmed : term;
  }
  return confirmed || asOf;
}

/** Build one month's exact accruals with two updates per relevant expense. */
export function monthlyUsage(
  entries: CostEntry[], calendarDays: string[], asOf: string, current = false,
): { days: { day: string; value: Fraction }[]; total: Fraction } {
  const zero = { n: 0n, d: 1n };
  const days = calendarDays.filter((day) => day <= asOf);
  if (!days.length) return { days: [], total: zero };
  const first = days[0], last = days[days.length - 1];
  const indices = new Map(days.map((day, index) => [day, index]));
  const changes = Array<Fraction>(days.length + 1).fill(zero);
  let total = zero;
  for (const entry of entries) {
    const immediate = entry.data.mode === "immediate";
    const start = immediate ? str(entry, "day") : str(entry, "startDay");
    const end = immediate ? start : effectiveEnd(entry, asOf);
    if (!start || !end || start > last || end < first) continue;
    const from = indices.get(start > first ? start : first);
    const through = indices.get(end < last ? end : last);
    if (from === undefined || through === undefined || from > through) continue;
    const rate = immediate ? { n: net(entry), d: 1n } : daily(entry, asOf, current);
    if (!rate || rate.n === 0n) continue;
    changes[from] = add(changes[from], rate);
    changes[through + 1] = add(changes[through + 1], { n: -rate.n, d: rate.d });
    total = add(total, { n: rate.n * BigInt(through - from + 1), d: rate.d });
  }
  let rate = zero;
  return {
    days: days.map((day, index) => {
      rate = add(rate, changes[index]);
      return { day, value: rate };
    }),
    total,
  };
}

export const isHistory = (e: CostEntry, asOf: string) =>
  e.data.mode !== "immediate" && effectiveEnd(e, asOf) < asOf;
/**
 * Long-term items as seen from one month; figures are always as of `asOf`.
 * Past month: everything in use during it (ended ones keep their final numbers).
 * Current month: what is in use now, everything already ended goes to `hidden`.
 */
export function longTerm<T extends CostEntry>(
  entries: T[],
  month: string,
  asOf: string,
): { shown: T[]; hidden: T[] } {
  const items = entries
    .filter((e) => e.data.mode !== "immediate" && /^\d{4}-\d{2}-\d{2}$/.test(str(e, "startDay")))
    .sort((a, b) => str(b, "startDay").localeCompare(str(a, "startDay")));
  if (month >= asOf.slice(0, 7))
    return {
      shown: items.filter((e) => !isHistory(e, asOf)),
      hidden: items.filter((e) => isHistory(e, asOf)),
    };
  return {
    shown: items.filter(
      (e) => str(e, "startDay") <= month + "-31" && effectiveEnd(e, asOf) >= month + "-01",
    ),
    hidden: [],
  };
}
