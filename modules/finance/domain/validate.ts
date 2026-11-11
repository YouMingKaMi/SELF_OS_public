type Amounts = {
  amountMinor: string;
  mode?: string;
  startDay?: string;
  endDay?: string;
  endedDay?: string;
};
/** Field shapes are checked by the schema; these are the ledger's own invariants. */
export function validateFinance(data: Amounts) {
  // Only a one-off entry may be negative (a refund recorded on its own day).
  if (data.mode !== "immediate" && data.amountMinor.startsWith("-"))
    throw new Error("INVALID_AMOUNT");
  if (
    data.mode &&
    data.mode !== "immediate" &&
    (!data.startDay || !data.endDay || data.startDay > data.endDay)
  )
    throw new Error("INVALID_TERM");
  if (data.endedDay && data.startDay && data.endedDay < data.startDay)
    throw new Error("INVALID_TERM");
}
