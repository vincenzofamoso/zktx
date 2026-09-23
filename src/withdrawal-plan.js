import { field } from "./notes.js";

function secureRandom() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0] / 2 ** 32;
}

export function planWithdrawals({ total, destinations, denominations, minDelayMinutes = 30, maxDelayMinutes = 24 * 60, now = Date.now(), random = secureRandom }) {
  const value = field(total);
  const recipients = [...new Set(destinations.map((item) => item.trim()))];
  if (recipients.length < 2 || recipients.length > 4) throw new Error("Provide 2 to 4 different destination wallets");
  if (recipients.some((item) => !/^0x[0-9a-fA-F]{40}$/.test(item))) throw new Error("Every destination must be a valid EVM address");
  if (!Number.isInteger(minDelayMinutes) || !Number.isInteger(maxDelayMinutes) || minDelayMinutes < 1 || maxDelayMinutes <= minDelayMinutes) throw new Error("Invalid delay window");
  const units = [...new Set(denominations.map(field).filter((item) => item > 0n))].sort((a, b) => a > b ? -1 : 1);
  if (!units.length) throw new Error("Provide at least one standard denomination");
  const pieces = [];
  let remaining = value;
  for (const unit of units) while (remaining >= unit) { pieces.push(unit); remaining -= unit; }
  if (pieces.length < recipients.length) throw new Error("The amount is too small to fund every destination using those denominations");
  const withdrawals = recipients.map((recipient) => ({ recipient, amount: 0n, executeAfter: 0 }));
  pieces.forEach((piece, index) => { withdrawals[index % withdrawals.length].amount += piece; });
  for (const withdrawal of withdrawals) {
    const delay = minDelayMinutes + Math.floor(random() * (maxDelayMinutes - minDelayMinutes + 1));
    withdrawal.executeAfter = now + delay * 60_000;
  }
  withdrawals.sort((a, b) => a.executeAfter - b.executeAfter);
  return { withdrawals, privateChange: remaining, plannedAmount: value - remaining };
}
