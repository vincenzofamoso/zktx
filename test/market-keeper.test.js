import assert from "node:assert/strict";
import test from "node:test";
import { minimumAfterSlippage } from "../src/market-keeper.js";

test("keeper applies buyback slippage protection", () => {
  assert.equal(minimumAfterSlippage(10_000n, 500), 9_500n);
  assert.throws(() => minimumAfterSlippage(10_000n, 10_000));
});
