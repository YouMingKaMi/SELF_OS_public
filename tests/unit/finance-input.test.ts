import { test } from "node:test";
import assert from "node:assert/strict";
import { minor } from "../../apps/web/src/features/finance-model.ts";

test("currency input normalizes surrounding spaces before reading its sign", () => {
  assert.equal(minor(" -1.25 "), "-125");
  assert.equal(minor("1.25"), "125");
  assert.equal(minor("0"), "0");
  assert.equal(minor(" -0.00"), "0");
  assert.equal(minor("9007199254740991.25"), "900719925474099125");
  assert.throws(() => minor("1.234"), /金额/);
});
