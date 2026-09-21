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

const copy = {
  shield: ["Create a shielded note", "Your deposit is public. Activity after shielding uses private notes."],
  send: ["Send a private note", "Recipient ownership and value are encrypted inside the shielded note set."],
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
  if (document.querySelector(".tabs .selected")?.dataset.tab !== "shield") {
    result.textContent = "Private sends, swaps, and withdrawals need a deposited note and production proof keys.";
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
