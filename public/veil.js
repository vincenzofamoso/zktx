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
const tokenLabel = document.querySelector("#token-label");
const amountLabel = document.querySelector("#amount-label");
const tokenMetaText = document.querySelector("#token-meta");
const amountUnits = document.querySelector("#amount-units");
const planner = document.querySelector("#withdrawal-planner");
const destinations = document.querySelector("#destinations");
const denominations = document.querySelector("#denominations");
const swapFields = document.querySelector("#swap-fields");
const receiveToken = document.querySelector("#receive-token");
const receiveAmount = document.querySelector("#receive-amount");
const receiveTokenMetaText = document.querySelector("#receive-token-meta");
const receiveAmountUnits = document.querySelector("#receive-amount-units");
const quoteLifetime = document.querySelector("#quote-lifetime");
const pendingMarketOrder = document.querySelector("#pending-market-order");
const settleMarket = document.querySelector("#settle-market");

const copy = {
  shield: ["Create a Zcash-style shielded note", "Keep your RH token. Its ownership becomes a private note—no ZEC or bridge required."],
  send: ["Send a private note", "Commitments hide ownership while a nullifier prevents the note from being spent twice."],
  swap: ["Execute a shielded PONS market trade", "The relayer hides your wallet; public slices execute promptly and settle back into private notes."],
  withdraw: ["Return to a public wallet", "The withdrawal destination and amount become public at the boundary."],
};

let connected = false;
let account = null;
let protocol = { mode: "preview", contractsReady: false, chainId: 4663, vaultAddress: null };
let payTokenMeta = null;
let receiveTokenMeta = null;

function parseTokenAmount(value, decimals) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Enter a positive token amount, such as 5 or 1.25");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places`);
  const units = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units;
}

async function readTokenMetadata(input, output, current) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.value.trim())) {
    output.textContent = "Paste a valid 0x token contract address.";
    output.className = "token-meta error";
    return null;
  }
  output.textContent = "Reading token from Robinhood Chain…";
  output.className = "token-meta";
  try {
    const response = await fetch(`./api/token/${input.value.trim()}`);
    const metadata = await response.json();
    if (!response.ok) throw new Error(metadata.error || "Token metadata unavailable");
    output.textContent = `${metadata.name} · ${metadata.symbol} · ${metadata.decimals} decimals`;
    output.className = "token-meta loaded";
    return metadata;
  } catch (error) {
    output.textContent = error?.message || "Token metadata unavailable";
    output.className = "token-meta error";
    return current;
  }
}

function showConversion(input, metadata, output) {
  if (!metadata || !input.value.trim()) {
    output.textContent = metadata ? `Enter the amount in ${metadata.symbol}.` : "Token decimals will be loaded from its contract.";
    output.className = "token-meta";
    return;
  }
  try {
    const units = parseTokenAmount(input.value, metadata.decimals);
    output.textContent = `${input.value} ${metadata.symbol} = ${units} base units`;
    output.className = "token-meta loaded";
  } catch (error) {
    output.textContent = error.message;
    output.className = "token-meta error";
  }
}

token.addEventListener("change", async () => { payTokenMeta = await readTokenMetadata(token, tokenMetaText, payTokenMeta); showConversion(amount, payTokenMeta, amountUnits); });
receiveToken.addEventListener("change", async () => { receiveTokenMeta = await readTokenMetadata(receiveToken, receiveTokenMetaText, receiveTokenMeta); showConversion(receiveAmount, receiveTokenMeta, receiveAmountUnits); });
amount.addEventListener("input", () => showConversion(amount, payTokenMeta, amountUnits));
receiveAmount.addEventListener("input", () => showConversion(receiveAmount, receiveTokenMeta, receiveAmountUnits));

function refreshLocalNotes() {
  const records = window.ZKTXWallet?.storedNotes() || [];
  const count = records.filter((record) => !record.spentBy).length;
  const pending = (window.ZKTXWallet?.storedMarketOrders() || []).filter((record) => !record.settled);
  localNotes.textContent = `${count} spendable encrypted note${count === 1 ? "" : "s"} and ${pending.length} pending market order${pending.length === 1 ? "" : "s"} stored only in this browser.`;
  pendingMarketOrder.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = pending.length ? "Select a pending order" : "No pending local orders";
  pendingMarketOrder.append(empty);
  for (const order of pending) {
    const option = document.createElement("option");
    option.value = order.orderId;
    option.textContent = `${order.orderId.slice(0, 10)}… · ${new Date(order.createdAt).toLocaleString()}`;
    pendingMarketOrder.append(option);
  }
}

try {
  const response = await fetch("./api/status");
  if (response.ok) protocol = await response.json();
} catch { /* Static preview has no API. */ }
refreshLocalNotes();
function selectTab(button) {
  document.querySelector(".tabs .selected")?.classList.remove("selected");
  button.classList.add("selected");
  [actionTitle.textContent, actionCopy.textContent] = copy[button.dataset.tab];
  planner.hidden = button.dataset.tab !== "withdraw";
  swapFields.hidden = button.dataset.tab !== "swap";
  tokenLabel.textContent = button.dataset.tab === "swap" ? "You pay with" : button.dataset.tab === "withdraw" ? "Token you want to withdraw" : "Token you want to shield";
  amountLabel.textContent = button.dataset.tab === "swap" ? "Amount to spend" : button.dataset.tab === "withdraw" ? "Total amount to withdraw" : "Amount to shield";
  submit.textContent = button.dataset.tab === "withdraw" ? "Build private withdrawal plan" : button.dataset.tab === "swap" ? "Submit shielded market trade" : button.dataset.tab === "shield" ? "Shield tokens" : "Create private send";
}
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => selectTab(button)));

// Telegram and other trusted entry points can hand off a reviewed action without
// placing passwords, private notes, proofs, or wallet secrets in the URL.
const handoff = new URL(location.href).searchParams;
const requestedTab = handoff.get("tab");
const requestedButton = Object.hasOwn(copy, requestedTab) ? document.querySelector(`.tabs button[data-tab="${requestedTab}"]`) : null;
if (requestedButton) selectTab(requestedButton);
if (handoff.get("token")) token.value = handoff.get("token");
if (handoff.get("amount")) amount.value = handoff.get("amount");
if (handoff.get("receiveToken")) receiveToken.value = handoff.get("receiveToken");
if (handoff.get("minimum")) receiveAmount.value = handoff.get("minimum");
if (handoff.get("deadline") && [...quoteLifetime.options].some((option) => option.value === handoff.get("deadline"))) quoteLifetime.value = handoff.get("deadline");
if (handoff.get("recipient")) destinations.value = handoff.get("recipient");
if (token.value) token.dispatchEvent(new Event("change"));
if (receiveToken.value) receiveToken.dispatchEvent(new Event("change"));

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
    if (Number(chainHex) !== protocol.chainId) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${protocol.chainId.toString(16)}` }] });
      } catch (switchError) {
        if (switchError?.code !== 4902) throw switchError;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: `0x${protocol.chainId.toString(16)}`,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        }] });
      }
    }
    result.textContent = protocol.contractsReady
      ? "Wallet connected. Experimental live shielding is enabled for capped pilot assets."
      : "Wallet connected, but the live pilot is not ready.";
  } catch (error) {
    result.textContent = error?.message || "Wallet connection was cancelled.";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = document.querySelector(".tabs .selected")?.dataset.tab;
  if (!payTokenMeta || payTokenMeta.address.toLowerCase() !== token.value.toLowerCase()) payTokenMeta = await readTokenMetadata(token, tokenMetaText, payTokenMeta);
  if (!payTokenMeta) { result.textContent = "Load a valid Robinhood Chain token first."; return; }
  let payUnits;
  try { payUnits = parseTokenAmount(amount.value, payTokenMeta.decimals); }
  catch (error) { result.textContent = error.message; return; }
  if (selected === "withdraw") {
    try {
      const plan = window.ZKTXWallet.planWithdrawals({ total: payUnits, destinations: destinations.value.split(/\r?\n/).filter(Boolean), denominations: denominations.value.split(",").map((value) => parseTokenAmount(value.trim(), payTokenMeta.decimals)) });
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
    if (!receiveTokenMeta || receiveTokenMeta.address.toLowerCase() !== receiveToken.value.toLowerCase()) receiveTokenMeta = await readTokenMetadata(receiveToken, receiveTokenMetaText, receiveTokenMeta);
    if (!receiveTokenMeta) { result.textContent = "Load a valid receive token first."; return; }
    let receiveUnits;
    try { receiveUnits = parseTokenAmount(receiveAmount.value, receiveTokenMeta.decimals); }
    catch (error) { result.textContent = error.message; return; }
    try {
      if (!connected || !account) throw new Error("Connect your wallet before opening a market order");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(quoteLifetime.value));
      const order = await window.ZKTXWallet.openMarketOrderLive({
        chainId: protocol.chainId,
        vaultAddress: protocol.vaultAddress,
        assetIn: token.value,
        amountIn: payUnits,
        assetOut: receiveToken.value,
        minimumAmountOut: receiveUnits,
        deadline,
        password: password.value,
        onProgress: (message) => { result.textContent = message; },
      });
      refreshLocalNotes();
      result.innerHTML = `Market order relayed. The keeper will execute its slices promptly. <a href="https://robinhoodchain.blockscout.com/tx/${order.transactionHash}" target="_blank" rel="noopener">View vault transaction ↗</a>`;
    } catch (error) { result.textContent = error?.message || "Could not open the shielded market order."; }
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
  try {
    if (!connected || !account) throw new Error("Connect your wallet before shielding");
    if (!protocol.contractsReady) throw new Error("The experimental live vault is not ready");
    const live = await window.ZKTXWallet.shieldLive({
      account, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress,
      asset: token.value, amount: payUnits, password: password.value,
      onProgress: (message) => { result.textContent = message; },
    });
    refreshLocalNotes();
    result.innerHTML = `Shielded deposit confirmed. Commitment ${live.record.commitment.slice(0, 12)}… <a href="https://robinhoodchain.blockscout.com/tx/${live.depositHash}" target="_blank" rel="noopener">View transaction ↗</a>`;
  } catch (error) {
    result.textContent = error?.message || "Could not create the encrypted note.";
  }
});

settleMarket.addEventListener("click", async () => {
  try {
    if (!connected || !account) throw new Error("Connect your wallet before settling");
    if (!pendingMarketOrder.value) throw new Error("Select a pending local market order");
    const settled = await window.ZKTXWallet.settleMarketOrderLive({
      orderId: pendingMarketOrder.value,
      password: password.value,
      onProgress: (message) => { result.textContent = message; },
    });
    refreshLocalNotes();
    result.innerHTML = settled.transactionHash
      ? `Actual proceeds returned to private notes. <a href="https://robinhoodchain.blockscout.com/tx/${settled.transactionHash}" target="_blank" rel="noopener">View settlement ↗</a>`
      : "Recovered the already-settled private notes into this browser.";
  } catch (error) { result.textContent = error?.message || "Could not settle the market order."; }
});
