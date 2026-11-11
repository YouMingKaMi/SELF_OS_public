export type UsageKind = "fixed" | "estimated";
export type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;
export type DailyCostInput = Readonly<{
  netCostMinor: bigint;
  kind: UsageKind;
  plannedDays: number;
  elapsedDays: number;
  actualDays?: number;
}>;
function days(value: number, allowZero = false): bigint {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error("INVALID_DAYS");
  return BigInt(value);
}
// Caller supplies calendar-day counts and as-of policy; dates and storage are intentionally outside this rule.
export function dailyCosts(input: DailyCostInput): {
  term: Rational;
  current: Rational | null;
} {
  if (!["fixed", "estimated"].includes(input.kind))
    throw new Error("INVALID_USAGE_KIND");
  const planned = days(input.plannedDays);
  const elapsed = days(input.elapsedDays, true);
  const actual =
    input.actualDays === undefined ? undefined : days(input.actualDays);
  const termDays = actual ?? planned;
  const currentDays = actual ?? (input.kind === "fixed" ? planned : elapsed);
  return {
    term: { numerator: input.netCostMinor, denominator: termDays },
    current:
      elapsed === 0n && actual === undefined
        ? null
        : { numerator: input.netCostMinor, denominator: currentDays },
  };
}
export function roundMinor(value: Rational): bigint {
  if (value.denominator <= 0n) throw new Error("INVALID_DENOMINATOR");
  const sign = value.numerator < 0n ? -1n : 1n;
  const n = value.numerator * sign;
  return sign * ((n * 2n + value.denominator) / (2n * value.denominator));
}
