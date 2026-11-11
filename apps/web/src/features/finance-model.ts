export function minor(value: string) {
  if (!/^-?\d+(\.\d{0,2})?$/.test(value.trim()))
    throw new Error("金额最多保留两位小数");
  const negative = value.startsWith("-");
  const [whole, part = ""] = value.replace("-", "").split(".");
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")))
  ).toString();
}
export function money(value: bigint | string) {
  const n = BigInt(value);
  const a = n < 0n ? -n : n;
  return (
    (n < 0n ? "−" : "") +
    "¥" +
    (a / 100n).toLocaleString("en-US") +
    "." +
    String(a % 100n).padStart(2, "0")
  );
}

export {
  dayCount,
  add,
  round,
  net,
  daily,
  usage,
  effectiveEnd,
  isHistory,
  longTerm,
} from "../../../../modules/finance/index.ts";
