import { test } from "node:test";
import assert from "node:assert/strict";
import { schema } from "../../../packages/contracts/schema.ts";
import { normalize } from "../domain/normalize.ts";

const expense = {
  title: "午饭",
  day: "2026-11-07",
  amountMinor: "3200",
  mode: "immediate",
};
test("absent means absent: null, undefined and empty non-text values are dropped", () => {
  assert.deepEqual(
    normalize(schema.expense, {
      ...expense,
      categoryId: "",
      endDay: null,
      note: "",
    }),
    { ...expense, note: "" },
  );
});
test("required fields reject missing and blank values", () => {
  assert.throws(
    () => normalize(schema.expense, { ...expense, title: "  " }),
    /REQUIRED:title/,
  );
  assert.throws(
    () => normalize(schema.expense, { ...expense, day: "" }),
    /REQUIRED:day/,
  );
});
test("unknown fields are rejected rather than stored", () => {
  assert.throws(
    () => normalize(schema.expense, { ...expense, extra: 1 }),
    /UNKNOWN_FIELD:extra/,
  );
});
test("money is an integer string; floats and fractions never pass", () => {
  for (const amountMinor of ["0.1", "1e3", 3200, "12345678901234567890"])
    assert.throws(
      () => normalize(schema.expense, { ...expense, amountMinor }),
      /INVALID_AMOUNT/,
    );
  assert.equal(
    normalize(schema.expense, { ...expense, amountMinor: "-500" }).amountMinor,
    "-500",
  );
  assert.throws(
    () => normalize(schema.budget, { month: "2026-11", amountMinor: "-1" }),
    /INVALID_AMOUNT/,
  );
});
test("days are real calendar days, months are YYYY-MM", () => {
  assert.throws(
    () => normalize(schema.expense, { ...expense, day: "2026-02-29" }),
    /INVALID_DATE:day/,
  );
  assert.throws(
    () => normalize(schema.budget, { month: "2026-13", amountMinor: "1" }),
    /INVALID_DATE:month/,
  );
});
test("timestamps need an offset and are stored as UTC milliseconds", () => {
  const entry = {
    walletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mode: "set",
    quantity: "1.5",
  };
  assert.equal(
    normalize(schema.walletEntry, { ...entry, at: "2026-11-07T08:00:00+08:00" })
      .at,
    "2026-11-07T00:00:00.000Z",
  );
  assert.throws(
    () => normalize(schema.walletEntry, { ...entry, at: "2026-11-07 08:00" }),
    /INVALID_TIME:at/,
  );
});
test("decimals keep exact text; enums, integers, references and lists are checked", () => {
  const entry = {
    walletId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    mode: "delta",
    at: "2026-11-07T00:00:00Z",
  };
  const clean = normalize(schema.walletEntry, {
    ...entry,
    quantity: "-0.000000000001",
  });
  assert.equal(clean.quantity, "-0.000000000001");
  assert.equal(clean.walletId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.throws(
    () => normalize(schema.walletEntry, { ...entry, quantity: 1.5 }),
    /INVALID_DECIMAL/,
  );
  assert.throws(
    () => normalize(schema.walletEntry, { ...entry, quantity: "1", mode: "x" }),
    /INVALID_FIELD:mode/,
  );
  assert.throws(
    () =>
      normalize(schema.walletEntry, {
        ...entry,
        quantity: "1",
        walletId: "nope",
      }),
    /INVALID_REFERENCE/,
  );
  const day = {
    name: "生日",
    calendar: "lunar",
    repeat: "yearly",
    intervalUnit: "year",
  };
  assert.throws(
    () => normalize(schema.importantDay, { ...day, lunarMonth: 1.5 }),
    /INVALID_NUMBER:lunarMonth/,
  );
  assert.throws(
    () => normalize(schema.importantDay, { ...day, lunarMonth: 13 }),
    /INVALID_NUMBER:lunarMonth/,
  );
  assert.throws(
    () => normalize(schema.checklist, { name: "出门", items: ["钥匙", 1] }),
    /INVALID_FIELD:items/,
  );
});
