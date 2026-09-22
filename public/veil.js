const connect = document.querySelector("#connect");
const submit = document.querySelector(".submit");
const form = document.querySelector("#veil-form");
const result = document.querySelector("#form-result");
const actionTitle = document.querySelector("#action-title");
const actionCopy = document.querySelector("#action-copy");
const localNotes = document.querySelector("#local-notes");
const password = document.querySelector("#note-password");
const token = document.querySelector("#token");
const amount = document.querySelector("#amount");
const planner = document.querySelector("#withdrawal-planner");
const destinations = document.querySelector("#destinations");
const denominations = document.querySelector("#denominations");
const swapFields = document.querySelector("#swap-fields");
const receiveToken = document.querySelector("#receive-token");
const receiveAmount = document.querySelector("#receive-amount");
const quoteLifetime = document.querySelector("#quote-lifetime");

const copy = {
  shield: ["Create a Zcash-style shielded note", "Keep your RH token. Its ownership becomes a private note—no ZEC or bridge required."],
  send: ["Send a private note", "Commitments hide ownership while a nullifier prevents the note from being spent twice."],
  swap: ["Swap inside the pool", "The proof conserves both assets without publishing the user's order."],
  withdraw: ["Return to a public wallet", "The withdrawal destination and amount become public at the boundary."],
};

let connected = false;
let account = null;
let protocol = { mode: "preview", contractsReady: false, chainId: 4663, vaultAddress: null };

function refreshLocalNotes() {
  const count = window.ZKTXWallet?.storedNotes().length || 0;
  localNotes.textContent = `${count} encrypted note${count === 1 ? "" : "s"} stored only in this browser.`;
}

try {
  const response = await fetch("./api/status");
  if (response.ok) protocol = await response.json();
} catch { /* Static preview has no API. */ }
refreshLocalNotes();
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".tabs .selected")?.classList.remove("selected");
  button.classList.add("selected");
  [actionTitle.textContent, actionCopy.textContent] = copy[button.dataset.tab];
  planner.hidden = button.dataset.tab !== "withdraw";
  swapFields.hidden = button.dataset.tab !== "swap";
  submit.textContent = button.dataset.tab === "withdraw" ? "Build private withdrawal plan" : button.dataset.tab === "swap" ? "Build private RFQ quote" : "Create encrypted preview note";
}));

connect.addEventListener("click", async () => {
  if (!window.ethereum) {
    result.textContent = "Install an EVM wallet to preview Robinhood Chain connectivity.";
    return;
  }
  try {
    [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const chainHex = await window.ethereum.request({ method: "eth_chainId" });
    connected = Boolean(account);
    connect.textContent = connected ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet";
    result.textContent = Number(chainHex) === protocol.chainId
      ? "Wallet connected to Robinhood Chain. Mainnet actions remain locked until audited contracts are deployed."
      : `Wallet connected, but chain ${Number(chainHex)} is selected. Switch to Robinhood Chain (${protocol.chainId}) before any future live action.`;
  } catch (error) {
    result.textContent = error?.message || "Wallet connection was cancelled.";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = document.querySelector(".tabs .selected")?.dataset.tab;
  if (selected === "withdraw") {
    try {
      const plan = window.ZKTXWallet.planWithdrawals({ total: BigInt(amount.value), destinations: destinations.value.split(/\r?\n/).filter(Boolean), denominations: denominations.value.split(",").map((value) => BigInt(value.trim())) });
      const summary = plan.withdrawals.map((item) => `${item.amount} → ${item.recipient.slice(0, 8)}… after ${new Date(item.executeAfter).toLocaleString()}`).join(" | ");
      result.textContent = `Preview plan: ${summary}. Private change: ${plan.privateChange}. No transaction was sent.`;
    } catch (error) { result.textContent = error?.message || "Could not create withdrawal plan."; }
    return;
  }
  if (selected === "swap") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token.value) || !/^0x[0-9a-fA-F]{40}$/.test(receiveToken.value)) {
      result.textContent = "Enter valid sell and receive token contract addresses.";
      return;
    }
    if (!/^\d+$/.test(amount.value) || BigInt(amount.value) <= 0n || !/^\d+$/.test(receiveAmount.value) || BigInt(receiveAmount.value) <= 0n) {
      result.textContent = "Enter both amounts as positive token base-unit integers.";
      return;
    }
    const expires = new Date(Date.now() + Number(quoteLifetime.value) * 1000);
    result.textContent = `Private RFQ preview: offer ${amount.value} for ${receiveAmount.value}; expires ${expires.toLocaleString()}. A live order requires a deposited note and production proof keys. No transaction was sent.`;
    return;
  }
  if (selected !== "shield") {
    result.textContent = "Private sends and withdrawals need a deposited note and production proof keys.";
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(token.value)) {
    result.textContent = "Enter a valid token contract address.";
    return;
  }
  if (!/^\d+$/.test(amount.value) || BigInt(amount.value) <= 0n) {
    result.textContent = "For the preview, enter the token amount in base units as a positive integer.";
    return;
  }
  try {
    const record = await window.ZKTXWallet.createEncryptedNote({
      chainId: protocol.chainId,
      vaultAddress: protocol.vaultAddress || "0x0000000000000000000000000000000000000001",
      asset: token.value,
      amount: BigInt(amount.value),
    }, password.value);
    refreshLocalNotes();
    result.textContent = `Encrypted preview note created. Commitment ${record.commitment.slice(0, 12)}… No transaction was sent.`;
  } catch (error) {
    result.textContent = error?.message || "Could not create the encrypted note.";
  }
});
