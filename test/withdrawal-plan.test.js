import assert from "node:assert/strict";
import test from "node:test";
import { planWithdrawals } from "../src/withdrawal-plan.js";

const destinations = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"];

test("planner uses standard units, multiple recipients, delays, and private change", () => {
  const plan = planWithdrawals({ total: 12_347n, destinations, denominations: [5_000n, 1_000n], minDelayMinutes: 30, maxDelayMinutes: 60, now: 1_000, random: () => 0.5 });
  assert.equal(plan.withdrawals.length, 2);
  assert.equal(plan.withdrawals.reduce((sum, item) => sum + item.amount, 0n), 12_000n);
  assert.equal(plan.privateChange, 347n);
  assert.ok(plan.withdrawals.every((item) => item.executeAfter > 1_000));
});

test("planner rejects a single recipient", () => {
  assert.throws(() => planWithdrawals({ total: 10n, destinations: destinations.slice(0, 1), denominations: [1n] }), /2 to 4/);
});
