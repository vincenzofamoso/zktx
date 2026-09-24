const connect = document.querySelector("#connect");
const submit = document.querySelector("#action-submit");
const form = document.querySelector("#veil-form");
const result = document.querySelector("#form-result");
const actionTitle = document.querySelector("#action-title");
const actionCopy = document.querySelector("#action-copy");
const localNotes = document.querySelector("#local-notes");
const legacyNotePassword = document.querySelector("#legacy-note-password");
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
const swapSetup = document.querySelector("#swap-setup");
const receiveToken = document.querySelector("#receive-token");
const receiveAmount = document.querySelector("#receive-amount");
const priceDeviation = document.querySelector("#price-deviation");
const receiveTokenMetaText = document.querySelector("#receive-token-meta");
const receiveAmountUnits = document.querySelector("#receive-amount-units");
const quoteLifetime = document.querySelector("#quote-lifetime");
const pendingMarketOrder = document.querySelector("#pending-market-order");
const settleMarket = document.querySelector("#settle-market");
const marketSettlement = document.querySelector("#market-settlement");
const swapPrerequisite = document.querySelector("#swap-prerequisite");
const portfolioToggle = document.querySelector("#portfolio-toggle");
const portfolioList = document.querySelector("#portfolio-list");
const activityTerminal = document.querySelector("#activity-terminal");
const activitySteps = document.querySelector("#activity-steps");
const activityState = document.querySelector("#activity-state");
const activityAction = document.querySelector("#activity-action");
const fundAction = document.querySelector("#fund-action");
const workflowGuide = document.querySelector("#workflow-guide");
const sendFields = document.querySelector("#send-fields");
const receiveFields = document.querySelector("#receive-fields");
const tokenField = document.querySelector("#token-field");
const amountField = document.querySelector("#amount-field");
const actionCard = document.querySelector("#action-card");
const privateRecipient = document.querySelector("#private-recipient");
const receiveAddressAction = document.querySelector("#receive-address-action");
const receiveAddress = document.querySelector("#receive-address");
const transferReceipt = document.querySelector("#transfer-receipt");
const importTransfer = document.querySelector("#import-transfer");
const sendReceiptWrap = document.querySelector("#send-receipt-wrap");
const sendReceipt = document.querySelector("#send-receipt");
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const quoteAssets = { weth: WETH, usdg: USDG };
let swapDirection = "buy";
let activeAction = "send";
let returnAfterShield = "send";

const copy = {
  shield: ["Create a Zcash-style shielded note", "Keep your RH token. Its ownership becomes a private note. No ZEC or bridge required."],
  send: ["Send a private note", "Commitments hide ownership while a nullifier prevents the note from being spent twice."],
  receive: ["Receive a private note", "Share a private receive address and add the sender's receipt to your portfolio."],
  swap: ["Swap without exposing your wallet", "Choose Buy or Sell. The vault executes through approved RH liquidity and returns proceeds as private notes."],
  withdraw: ["Unshield to a public wallet", "Convert a private note back into public tokens at the wallet you choose."],
};

let connected = false;
let account = null;
let protocol = { mode: "preview", contractsReady: false, chainId: 4663, vaultAddress: null };
let payTokenMeta = null;
let receiveTokenMeta = null;
let activityLastMessage = "";
let automaticNotePassword;

async function notePassword() {
  const legacy = legacyNotePassword?.value?.trim();
  if (legacy?.length >= 10) return legacy;
  if (automaticNotePassword) return automaticNotePassword;
  if (!connected || !account || !window.ethereum) throw new Error("Connect your wallet first");
  const message = `ZKTX private notes v1\nRobinhood Chain\n${account.toLowerCase()}`;
  const encoded = `0x${[...new TextEncoder().encode(message)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signature = await window.ethereum.request({ method: "personal_sign", params: [encoded, account] });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature)));
  automaticNotePassword = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return automaticNotePassword;
}

function startActivity() {
  activitySteps.replaceChildren();
  activityTerminal.hidden = false;
  activityAction.hidden = true;
  activityState.textContent = "Running";
  activityLastMessage = "";
}

function logActivity(message, kind = "done", details = {}) {
  if (!message || message === activityLastMessage) return;
  activityLastMessage = message;
  const line = document.createElement("div");
  line.className = `activity-line ${kind}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const marker = document.createElement("i");
  marker.textContent = kind === "error" ? "×" : kind === "success" ? "✓" : "›";
  const copy = document.createElement("span");
  if (details.transactionHash) {
    const link = document.createElement("a");
    link.href = `https://robinhoodchain.blockscout.com/tx/${details.transactionHash}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${message} · View transaction ↗`;
    copy.append(link);
  } else copy.textContent = message;
  line.append(time, marker, copy);
  activitySteps.append(line);
  activitySteps.scrollTop = activitySteps.scrollHeight;
}

async function monitorMarketOrder(orderId, deadline) {
  let lastSlices = -1;
  const linkedSlices = new Set();
  const stopAt = Math.max(Number(deadline) + 120, Math.floor(Date.now() / 1000) + 180);
  while (Math.floor(Date.now() / 1000) < stopAt) {
    const response = await fetch(`./api/market/order/${orderId}`, { cache: "no-store" });
    if (response.ok) {
      const order = await response.json();
      const slices = Number(order.slicesExecuted);
      const total = Number(order.sliceCount);
      for (const [index, transactionHash] of (order.sliceTransactions || []).entries()) {
        if (linkedSlices.has(transactionHash)) continue;
        linkedSlices.add(transactionHash);
        logActivity(`Execution slice ${index + 1} confirmed`, "done", { transactionHash });
      }
      if (slices !== lastSlices) {
        logActivity(slices === 0 ? `Order accepted. Waiting for ${total} execution slices.` : `Execution slice ${slices} of ${total} confirmed.`);
        lastSlices = slices;
      }
      const complete = BigInt(order.executedInput) >= BigInt(order.amountIn);
      const readyAt = complete ? Number(order.lastExecutionAt) + 30 : Number(order.deadline) + 30;
      const now = Math.floor(Date.now() / 1000);
      if (!complete) {
        const remaining = Math.max(0, Number(order.deadline) - now);
        activityState.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`;
      }
      if ((complete || now >= Number(order.deadline)) && now >= readyAt) return order;
      if (complete) activityState.textContent = `Claiming in ${Math.max(0, readyAt - now)}s`;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error("The order is still pending. You can safely return later and claim it from this browser.");
}

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

function formatTokenAmount(value, decimals) {
  if (!decimals) return BigInt(value).toString();
  const padded = BigInt(value).toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

token.addEventListener("change", async () => { payTokenMeta = await readTokenMetadata(token, tokenMetaText, payTokenMeta); showConversion(amount, payTokenMeta, amountUnits); await updateDexQuote(); });
receiveToken.addEventListener("change", async () => { receiveTokenMeta = await readTokenMetadata(receiveToken, receiveTokenMetaText, receiveTokenMeta); await updateDexQuote(); });
amount.addEventListener("input", () => { showConversion(amount, payTokenMeta, amountUnits); void updateDexQuote(); });
priceDeviation.addEventListener("input", () => void updateDexQuote());

let quoteRequest = 0;
async function updateDexQuote() {
  if (activeAction !== "swap" || !payTokenMeta || !receiveTokenMeta || !amount.value.trim()) return;
  const deviation = Number(priceDeviation.value);
  if (!Number.isFinite(deviation) || deviation < 0.1 || deviation > 25) {
    receiveAmount.value = "";
    receiveAmountUnits.textContent = "Choose a deviation between 0.1% and 25%.";
    receiveAmountUnits.className = "token-meta error";
    return;
  }
  const request = ++quoteRequest;
  receiveAmountUnits.textContent = "Reading current prices from Dexscreener...";
  receiveAmountUnits.className = "token-meta";
  try {
    const [payResponse, receiveResponse] = await Promise.all([
      fetch(`./api/dex-price/${token.value}`),
      fetch(`./api/dex-price/${receiveToken.value}`),
    ]);
    const [payPrice, receivePrice] = await Promise.all([payResponse.json(), receiveResponse.json()]);
    if (!payResponse.ok) throw new Error(payPrice.error || `No Dexscreener price for ${payTokenMeta.symbol}`);
    if (!receiveResponse.ok) throw new Error(receivePrice.error || `No Dexscreener price for ${receiveTokenMeta.symbol}`);
    const input = Number(amount.value);
    const marketOutput = input * Number(payPrice.priceUsd) / Number(receivePrice.priceUsd);
    const protectedOutput = marketOutput * (1 - deviation / 100);
    if (!Number.isFinite(protectedOutput) || protectedOutput <= 0) throw new Error("Dexscreener could not produce a valid quote");
    if (request !== quoteRequest) return;
    receiveAmount.value = protectedOutput.toFixed(Math.min(receiveTokenMeta.decimals, 12)).replace(/0+$/, "").replace(/\.$/, "");
    receiveAmountUnits.textContent = `Current estimate: ${marketOutput.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${receiveTokenMeta.symbol}. Protected minimum at ${deviation}% deviation: ${receiveAmount.value} ${receiveTokenMeta.symbol}.`;
    receiveAmountUnits.className = "token-meta loaded";
  } catch (error) {
    if (request !== quoteRequest) return;
    receiveAmount.value = "";
    receiveAmountUnits.textContent = error.message || "Dexscreener price unavailable for this pair.";
    receiveAmountUnits.className = "token-meta error";
  }
}

async function showPortfolio() {
  portfolioToggle.disabled = true;
  try {
    const notes = await window.ZKTXWallet.privatePortfolio(await notePassword());
    portfolioList.replaceChildren();
    const grouped = new Map();
    for (const note of notes) {
      const key = note.asset.toLowerCase();
      const group = grouped.get(key) || { asset: note.asset, total: 0n, notes: [] };
      group.total += BigInt(note.amount); group.notes.push(note); grouped.set(key, group);
    }
    for (const group of grouped.values()) {
      const response = await fetch(`./api/token/${group.asset}`);
      const metadata = response.ok ? await response.json() : { symbol: `${group.asset.slice(0, 6)}…`, decimals: 0 };
      const row = document.createElement("div"); row.className = "portfolio-item";
      const asset = document.createElement("span"); asset.textContent = `${metadata.symbol} · ${group.notes.length} private note${group.notes.length === 1 ? "" : "s"}`;
      const balance = document.createElement("span"); balance.textContent = `${formatTokenAmount(group.total, metadata.decimals)} total`;
      const actions = document.createElement("div"); actions.className = "portfolio-note-actions";
      for (const note of group.notes) {
        const formatted = formatTokenAmount(note.amount, metadata.decimals);
        const unshield = document.createElement("button");
        unshield.type = "button"; unshield.className = "portfolio-withdraw"; unshield.textContent = `Unshield ${formatted}`;
        unshield.addEventListener("click", () => {
          selectTab(document.querySelector('#withdraw-action'));
          token.value = note.asset; amount.value = formatted; token.dispatchEvent(new Event("change")); destinations.focus();
          result.textContent = `Enter the destination wallet, then confirm Unshield tokens to withdraw this ${metadata.symbol} note.`;
        });
        actions.append(unshield);
      }
      row.append(asset, balance, actions); portfolioList.append(row);
    }
    if (!notes.length) portfolioList.textContent = "No shielded tokens found for this wallet.";
    portfolioList.hidden = false; portfolioToggle.textContent = "Refresh portfolio";
  } finally { portfolioToggle.disabled = false; }
}
portfolioToggle.addEventListener("click", () => void showPortfolio());

receiveAddressAction.addEventListener("click", async () => {
  try {
    const address = await window.ZKTXWallet.privateReceiveAddress(await notePassword());
    receiveAddress.hidden = false;
    receiveAddress.textContent = address;
    await navigator.clipboard?.writeText(address);
    result.textContent = "Private receive address copied. Send it to the person who will make the private transfer.";
  } catch (error) { result.textContent = error?.message || "Could not create the private receive address."; }
});

importTransfer.addEventListener("click", async () => {
  try {
    await window.ZKTXWallet.importPrivateTransfer(transferReceipt.value, await notePassword());
    transferReceipt.value = "";
    refreshLocalNotes();
    await showPortfolio();
    result.textContent = "Private transfer imported into this portfolio.";
  } catch (error) { result.textContent = error?.message || "Could not import the private transfer."; }
});

function applySwapDirection() {
  const quote = document.querySelector(".quote-assets button.selected")?.dataset.quote;
  if (!quote) return;
  const address = quoteAssets[quote];
  if (swapDirection === "buy") { token.value = address; token.disabled = true; receiveToken.disabled = false; tokenLabel.textContent = "You pay with"; }
  else { receiveToken.value = address; receiveToken.disabled = true; token.disabled = false; tokenLabel.textContent = "Token you sell"; }
  token.dispatchEvent(new Event("change")); receiveToken.dispatchEvent(new Event("change"));
}
document.querySelectorAll(".swap-direction button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".swap-direction .selected")?.classList.remove("selected"); button.classList.add("selected"); swapDirection = button.dataset.direction; applySwapDirection();
}));
document.querySelectorAll(".quote-assets button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".quote-assets .selected")?.classList.remove("selected"); button.classList.add("selected"); applySwapDirection();
}));

function refreshLocalNotes() {
  const records = window.ZKTXWallet?.storedNotes() || [];
  const count = records.filter((record) => !record.spentBy).length;
  const pending = (window.ZKTXWallet?.storedMarketOrders() || []).filter((record) => !record.settled);
  localNotes.textContent = `${count} spendable encrypted note${count === 1 ? "" : "s"} and ${pending.length} pending market order${pending.length === 1 ? "" : "s"} stored only in this browser.`;
  pendingMarketOrder.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = pending.length ? `${pending.length} completed swap${pending.length === 1 ? "" : "s"} waiting` : "No pending local orders";
  pendingMarketOrder.append(empty);
  for (const order of pending) {
    const option = document.createElement("option");
    option.value = order.orderId;
    option.textContent = `Swap ${pending.indexOf(order) + 1} of ${pending.length} · ${new Date(order.createdAt).toLocaleString()}`;
    pendingMarketOrder.append(option);
  }
  marketSettlement.hidden = pending.length === 0;
  if (pending.length) pendingMarketOrder.value = pending[0].orderId;
  settleMarket.disabled = pending.length === 0;
  swapPrerequisite.textContent = count === 0
    ? "No matching private balance yet. ZKTX will automatically shield the input amount when you submit."
    : "ZKTX will use a matching private balance, or automatically shield the exact input amount if needed.";
}

pendingMarketOrder.addEventListener("change", () => { settleMarket.disabled = !pendingMarketOrder.value; });

try {
  const response = await fetch("./api/status");
  if (response.ok) protocol = await response.json();
} catch { /* Static preview has no API. */ }
refreshLocalNotes();
function selectTab(button) {
  document.querySelector(".tabs .selected")?.classList.remove("selected");
  activeAction = button.dataset.tab;
  if (button.closest(".tabs")) button.classList.add("selected");
  [actionTitle.textContent, actionCopy.textContent] = copy[button.dataset.tab];
  planner.hidden = button.dataset.tab !== "withdraw";
  swapFields.hidden = button.dataset.tab !== "swap";
  swapSetup.hidden = button.dataset.tab !== "swap";
  sendFields.hidden = button.dataset.tab !== "send";
  receiveFields.hidden = button.dataset.tab !== "receive";
  workflowGuide.hidden = button.dataset.tab !== "send";
  const receiveMode = button.dataset.tab === "receive";
  tokenField.hidden = receiveMode;
  amountField.hidden = receiveMode;
  actionCard.hidden = receiveMode;
  submit.hidden = receiveMode;
  token.disabled = false; receiveToken.disabled = false;
  tokenLabel.textContent = button.dataset.tab === "swap" ? "You pay with" : button.dataset.tab === "withdraw" ? "Token you want to withdraw" : "Token you want to shield";
  amountLabel.textContent = button.dataset.tab === "swap" ? "Amount to spend" : button.dataset.tab === "withdraw" ? "Total amount to withdraw" : "Amount to shield";
  submit.textContent = button.dataset.tab === "withdraw" ? "Unshield tokens" : button.dataset.tab === "swap" ? "Submit Private Swap" : button.dataset.tab === "shield" ? "Shield tokens" : "Create private send";
  if (button.dataset.tab === "swap") {
    if (!document.querySelector(".quote-assets .selected")) document.querySelector('.quote-assets button[data-quote="weth"]').classList.add("selected");
    applySwapDirection();
  }
}
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => selectTab(button)));
document.querySelectorAll("#shield-action, #withdraw-action").forEach((button) => button.addEventListener("click", () => selectTab(button)));
selectTab(document.querySelector(".tabs .selected"));
fundAction.addEventListener("click", () => {
  returnAfterShield = activeAction === "swap" ? "swap" : "send";
  selectTab(document.querySelector("#shield-action"));
  result.textContent = "Step 1: choose the token and exact amount you want to use, then create your private balance.";
  token.focus();
});

// Trusted entry points pass action details without secrets in the URL.
const handoff = new URL(location.href).searchParams;
const requestedTab = handoff.get("tab");
const requestedButton = Object.hasOwn(copy, requestedTab) ? document.querySelector(`[data-tab="${requestedTab}"]`) : null;
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
    automaticNotePassword = undefined;
    [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    connected = Boolean(account);
    connect.textContent = connected ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet";
    try {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
        chainId: `0x${protocol.chainId.toString(16)}`,
        chainName: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://zktx.tech/api/rpc"],
        blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
      }] });
    } catch (networkError) {
      if (networkError?.code === 4001) throw new Error("Approve the Robinhood Chain network update so transactions use the reliable RPC endpoint");
    }
    const chainHex = await window.ethereum.request({ method: "eth_chainId" });
    if (Number(chainHex) !== protocol.chainId) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${protocol.chainId.toString(16)}` }] });
      } catch (switchError) {
        if (switchError?.code !== 4902) throw switchError;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: `0x${protocol.chainId.toString(16)}`,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://zktx.tech/api/rpc"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        }] });
      }
    }
    result.textContent = protocol.contractsReady
      ? "Wallet connected. Your private workspace is ready."
      : "Wallet connected, but the private workspace is temporarily unavailable.";
  } catch (error) {
    result.textContent = error?.message || "Wallet connection was cancelled.";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = activeAction;
  if (!payTokenMeta || payTokenMeta.address.toLowerCase() !== token.value.toLowerCase()) payTokenMeta = await readTokenMetadata(token, tokenMetaText, payTokenMeta);
  if (!payTokenMeta) { result.textContent = "Load a valid Robinhood Chain token first."; return; }
  let payUnits;
  try { payUnits = parseTokenAmount(amount.value, payTokenMeta.decimals); }
  catch (error) { result.textContent = error.message; return; }
  if (selected === "withdraw") {
    try {
      if (!connected || !account) throw new Error("Connect your wallet before unshielding");
      const recipient = destinations.value.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Enter one valid destination wallet");
      const withdrawal = await window.ZKTXWallet.withdrawLive({
        chainId: protocol.chainId,
        vaultAddress: protocol.vaultAddress,
        asset: token.value,
        amount: payUnits,
        recipient,
        password: await notePassword(),
        onProgress: (message) => { result.textContent = message; },
      });
      refreshLocalNotes();
      result.innerHTML = `Tokens unshielded to ${recipient.slice(0, 8)}… <a href="https://robinhoodchain.blockscout.com/tx/${withdrawal.transactionHash}" target="_blank" rel="noopener">View withdrawal ↗</a>`;
    } catch (error) { result.textContent = error?.message || "Could not unshield the private note."; }
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
    if (!receiveAmount.value) { result.textContent = "Wait for the Dexscreener quote before submitting the swap."; return; }
    try { receiveUnits = parseTokenAmount(receiveAmount.value, receiveTokenMeta.decimals); }
    catch (error) { result.textContent = error.message; return; }
    try {
      startActivity();
      logActivity("Validating token pair and private balance.");
      result.textContent = "Swap execution started. Follow the live terminal below.";
      logActivity("Finding executable Robinhood Chain liquidity.");
      const routeResponse = await fetch(`./api/route/${token.value}/${receiveToken.value}/ensure`, { method: "POST" });
      const route = await routeResponse.json();
      if (!routeResponse.ok || !route.approved) throw new Error(route.error || "No executable RH liquidity route was found for this pair");
      logActivity("Approved Robinhood Chain liquidity route is ready.");
      if (!connected || !account) throw new Error("Connect your wallet before opening a market order");
      const privateNoteKey = await notePassword();
      const orderInput = () => ({
        chainId: protocol.chainId, vaultAddress: protocol.vaultAddress, assetIn: token.value, amountIn: payUnits,
        assetOut: receiveToken.value, minimumAmountOut: receiveUnits,
        deadline: BigInt(Math.floor(Date.now() / 1000) + Number(quoteLifetime.value)), password: privateNoteKey,
        onProgress: (message, details) => { logActivity(message, "done", details); },
      });
      let order;
      let submittedOrder = orderInput();
      try {
        order = await window.ZKTXWallet.openMarketOrderLive(submittedOrder);
      } catch (error) {
        if (!String(error?.message || "").includes("No unspent local note exactly matches")) throw error;
        logActivity("Preparing the private swap balance from your wallet.");
        await window.ZKTXWallet.shieldLive({
          account, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress,
          asset: token.value, amount: payUnits, password: privateNoteKey,
          onProgress: (message, details) => { logActivity(message, "done", details); },
        });
        logActivity("Private swap balance ready. Opening the order.", "success");
        submittedOrder = orderInput();
        order = await window.ZKTXWallet.openMarketOrderLive(submittedOrder);
      }
      refreshLocalNotes();
      logActivity("Private order relayed to the execution vault.");
      const executed = await monitorMarketOrder(order.orderId, submittedOrder.deadline);
      logActivity(`Swap complete. ${executed.slicesExecuted} of ${executed.sliceCount} slices confirmed.`, "success");
      activityState.textContent = "Auto claiming";
      logActivity(executed.slicesExecuted === 0 ? "The execution window ended without a fill. Restoring the input balance." : "Automatically adding swap proceeds to your private portfolio.");
      const settled = await window.ZKTXWallet.settleMarketOrderLive({
        orderId: order.orderId,
        password: privateNoteKey,
        onProgress: (message, details) => logActivity(message, "done", details),
      });
      refreshLocalNotes();
      activityState.textContent = "Complete";
      logActivity("Private portfolio updated automatically.", "success", { transactionHash: settled.transactionHash });
      activityAction.hidden = true;
      result.innerHTML = `${executed.slicesExecuted === 0 ? "The order was not filled and your input was restored" : "Swap completed and proceeds were added to your private portfolio"}. <a href="https://robinhoodchain.blockscout.com/tx/${settled.transactionHash}" target="_blank" rel="noopener">View settlement ↗</a>`;
    } catch (error) {
      activityState.textContent = "Action needed";
      logActivity(error?.message || "Swap execution stopped.", "error");
      result.textContent = error?.message?.includes("Error in template MarketOrder")
          ? "The selected private note is not synchronized with the current vault. Refresh the page, wait a few seconds, then try again."
        : error?.message || "Could not open the shielded market order.";
    }
    return;
  }
  if (selected === "send") {
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(privateRecipient.value.trim())) throw new Error("Enter the recipient's ZKTX private receive address");
      startActivity();
      result.textContent = "Private Send started. Follow the live terminal below.";
      const sent = await window.ZKTXWallet.privateSendLive({
        chainId: protocol.chainId,
        vaultAddress: protocol.vaultAddress,
        asset: token.value,
        amount: payUnits,
        recipientPrivateAddress: privateRecipient.value.trim(),
        password: await notePassword(),
        onProgress: (message, details) => logActivity(message, "done", details),
      });
      refreshLocalNotes();
      activityState.textContent = "Complete";
      logActivity("Private Send completed. Share the receipt with the recipient.", "success");
      sendReceiptWrap.hidden = false;
      sendReceipt.value = sent.receipt;
      await navigator.clipboard?.writeText(sent.receipt);
      result.innerHTML = `Private transfer confirmed. The recipient receipt was copied. Send that receipt to the recipient so they can import it. <a href="https://robinhoodchain.blockscout.com/tx/${sent.transactionHash}" target="_blank" rel="noopener">View transaction ↗</a>`;
    } catch (error) {
      activityState.textContent = "Action needed";
      logActivity(error?.message || "Private Send stopped.", "error");
      result.textContent = error?.message || "Could not complete the Private Send.";
    }
    return;
  }
  if (selected !== "shield") {
    result.textContent = "This action is unavailable.";
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
      asset: token.value, amount: payUnits, password: await notePassword(),
      onProgress: (message) => { result.textContent = message; },
    });
    refreshLocalNotes();
    result.innerHTML = live.indexed
      ? `Shielded deposit confirmed and ready to use. Commitment ${live.record.commitment.slice(0, 12)}… <a href="https://robinhoodchain.blockscout.com/tx/${live.depositHash}" target="_blank" rel="noopener">View transaction ↗</a>`
      : `Shielded deposit confirmed onchain. The private balance is still syncing, so wait a few seconds before swapping. <a href="https://robinhoodchain.blockscout.com/tx/${live.depositHash}" target="_blank" rel="noopener">View transaction ↗</a>`;
    const destination = document.querySelector(`.tabs button[data-tab="${returnAfterShield}"]`);
    if (destination) selectTab(destination);
  } catch (error) {
    result.textContent = error?.message || "Could not create the encrypted note.";
  }
});

settleMarket.addEventListener("click", async () => {
  try {
    if (activityTerminal.hidden) startActivity();
    if (!connected || !account) throw new Error("Connect your wallet before settling");
    if (!pendingMarketOrder.value) throw new Error("Select a pending local market order");
    const settled = await window.ZKTXWallet.settleMarketOrderLive({
      orderId: pendingMarketOrder.value,
      password: await notePassword(),
      onProgress: (message, details) => { logActivity(message, "done", details); result.textContent = message; },
    });
    refreshLocalNotes();
    activityState.textContent = "Claimed";
    activityAction.hidden = true;
    logActivity("Purchased tokens claimed into your private portfolio.", "success");
    result.innerHTML = settled.transactionHash
      ? `Purchased tokens are now in your private portfolio. Open the portfolio and choose Unshield to wallet when you want to withdraw. <a href="https://robinhoodchain.blockscout.com/tx/${settled.transactionHash}" target="_blank" rel="noopener">View settlement ↗</a>`
      : "Recovered the already-settled private notes into this browser.";
  } catch (error) { result.textContent = error?.message || "Could not settle the market order."; }
});

activityAction.addEventListener("click", () => settleMarket.click());
