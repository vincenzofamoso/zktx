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
const priceProtectionCopy = document.querySelector("#price-protection-copy");
const receiveTokenMetaText = document.querySelector("#receive-token-meta");
const receiveAmountUnits = document.querySelector("#receive-amount-units");
const quoteLifetime = document.querySelector("#quote-lifetime");
const pendingMarketOrder = document.querySelector("#pending-market-order");
const settleMarket = document.querySelector("#settle-market");
const marketSettlement = document.querySelector("#market-settlement");
const swapPrerequisite = document.querySelector("#swap-prerequisite");
const portfolioToggle = document.querySelector("#portfolio-toggle");
const portfolioList = document.querySelector("#portfolio-list");
const portfolioPanel = document.querySelector("#portfolio-panel");
const bulkUnshield = document.querySelector("#bulk-unshield");
const bulkUnshieldRecipient = document.querySelector("#bulk-unshield-recipient");
const activityTerminal = document.querySelector("#activity-terminal");
const activitySteps = document.querySelector("#activity-steps");
const activityState = document.querySelector("#activity-state");
const activityAction = document.querySelector("#activity-action");
const activityClose = document.querySelector("#activity-close");
const fundAction = document.querySelector("#fund-action");
const workflowGuide = document.querySelector("#workflow-guide");
const sendFields = document.querySelector("#send-fields");
const receiveFields = document.querySelector("#receive-fields");
const tokenField = document.querySelector("#token-field");
const amountField = document.querySelector("#amount-field");
const amountHalf = document.querySelector("#amount-half");
const amountMax = document.querySelector("#amount-max");
const walletAssets = document.querySelector("#wallet-assets");
const walletAssetsTitle = document.querySelector("#wallet-assets-title");
const walletAssetsAccount = document.querySelector("#wallet-assets-account");
const walletAssetsList = document.querySelector("#wallet-assets-list");
const walletAssetsStatus = document.querySelector("#wallet-assets-status");
const walletAssetsRefresh = document.querySelector("#wallet-assets-refresh");
const swapPrivateAssets = document.querySelector("#swap-private-assets");
const swapPrivateAssetsList = document.querySelector("#swap-private-assets-list");
const swapPrivateAssetsStatus = document.querySelector("#swap-private-assets-status");
const swapPrivateRefresh = document.querySelector("#swap-private-refresh");
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
let swapSource = "portfolio";
let activeAction = "send";
let returnAfterShield = "send";

const copy = {
  shield: ["Create a Zcash-style shielded note", "Keep your RH token. Its ownership becomes a private note. No ZEC or bridge required."],
  send: ["Send a private note", "Commitments hide ownership while a nullifier prevents the note from being spent twice."],
  receive: ["Receive a private note", "Share a private receive address and add the sender's receipt to your portfolio."],
  swap: ["Swap without exposing your wallet", "Choose Buy or Sell. The vault executes through approved RH liquidity and returns proceeds as private notes."],
  portfolio: ["Private portfolio", "View, manage and unshield the private balances held by this wallet."],
  withdraw: ["Unshield to a public wallet", "Convert a private note back into public tokens at the wallet you choose."],
};

let connected = false;
let account = null;
let protocol = { mode: "preview", contractsReady: false, chainId: 4663, vaultAddress: null };
let payTokenMeta = null;
let receiveTokenMeta = null;
let connectedWalletAssets = [];
let selectedWalletBalance = null;
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
activityClose.addEventListener("click", () => { activityTerminal.hidden = true; });

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

token.addEventListener("change", async () => {
  payTokenMeta = await readTokenMetadata(token, tokenMetaText, payTokenMeta);
  const selectedAddress = token.value.trim().toLowerCase();
  const keepPrivateSelection = activeAction === "swap" && swapSource === "portfolio" && selectedWalletBalance?.address.toLowerCase() === selectedAddress;
  if (!keepPrivateSelection) selectedWalletBalance = connectedWalletAssets.find((asset) => asset.address.toLowerCase() === selectedAddress) || null;
  showConversion(amount, payTokenMeta, amountUnits);
  await updateDexQuote();
});
receiveToken.addEventListener("change", async () => { receiveTokenMeta = await readTokenMetadata(receiveToken, receiveTokenMetaText, receiveTokenMeta); await updateDexQuote(); });
amount.addEventListener("input", () => { showConversion(amount, payTokenMeta, amountUnits); void updateDexQuote(); });
priceDeviation.addEventListener("input", () => void updateDexQuote());

function applyWalletAmount(portion) {
  if (!selectedWalletBalance) {
    result.textContent = "Choose a token from your connected wallet first.";
    return;
  }
  const raw = portion === "half" ? BigInt(selectedWalletBalance.balance) / 2n : BigInt(selectedWalletBalance.balance);
  if (raw <= 0n) {
    result.textContent = "This token balance is too small to use.";
    return;
  }
  amount.value = formatTokenAmount(raw, selectedWalletBalance.decimals);
  amount.dispatchEvent(new Event("input"));
}
amountHalf.addEventListener("click", () => applyWalletAmount("half"));
amountMax.addEventListener("click", () => applyWalletAmount("max"));

async function loadWalletAssets() {
  walletAssetsList.replaceChildren();
  selectedWalletBalance = null;
  if (!connected || !account) {
    walletAssetsAccount.textContent = "Connect a wallet to load balances.";
    walletAssetsStatus.textContent = "Your token list will appear here after connecting.";
    return;
  }
  walletAssetsRefresh.disabled = true;
  walletAssetsAccount.textContent = `${account.slice(0, 8)}…${account.slice(-6)}`;
  walletAssetsStatus.textContent = "Loading token names and balances from Robinhood Chain…";
  try {
    const response = await fetch(`./api/wallet/${account}/assets`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Wallet balances are unavailable");
    connectedWalletAssets = (payload.assets || []).sort((left, right) => left.symbol.localeCompare(right.symbol));
    for (const asset of connectedWalletAssets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wallet-asset";
      const identity = document.createElement("span");
      const symbol = document.createElement("b"); symbol.textContent = asset.symbol;
      const name = document.createElement("small"); name.textContent = asset.name;
      const balance = document.createElement("strong"); balance.textContent = formatTokenAmount(asset.balance, asset.decimals);
      identity.append(symbol, name); button.append(identity, balance);
      button.addEventListener("click", () => {
        walletAssetsList.querySelector(".selected")?.classList.remove("selected");
        button.classList.add("selected");
        selectedWalletBalance = asset;
        token.value = asset.address;
        token.dispatchEvent(new Event("change"));
        amount.value = "";
        amount.focus();
        walletAssetsStatus.textContent = `${asset.symbol} selected. Enter an amount or choose Half or Max.${activeAction === "swap" ? " ZKTX will shield it automatically before selling." : ""}`;
      });
      walletAssetsList.append(button);
    }
    walletAssetsStatus.textContent = connectedWalletAssets.length
      ? `${connectedWalletAssets.length} token balance${connectedWalletAssets.length === 1 ? "" : "s"} found. Choose one to continue.${payload.truncated ? " Showing the first 100 indexed balances." : ""}`
      : "No ERC-20 token balances were found in this wallet.";
  } catch (error) {
    connectedWalletAssets = [];
    walletAssetsStatus.textContent = error?.message || "Could not load wallet token balances.";
  } finally {
    walletAssetsRefresh.disabled = false;
  }
}
walletAssetsRefresh.addEventListener("click", () => void loadWalletAssets());

async function loadPrivateSwapAssets() {
  swapPrivateRefresh.disabled = true;
  swapPrivateAssetsList.replaceChildren();
  swapPrivateAssetsStatus.textContent = "Decrypting spendable private balances in this browser…";
  try {
    if (!connected || !account) throw new Error("Connect your wallet to open the Private Portfolio");
    const notes = await window.ZKTXWallet.privatePortfolio(await notePassword());
    const eligible = swapDirection === "buy"
      ? notes.filter((note) => note.asset.toLowerCase() === token.value.toLowerCase())
      : notes;
    for (const note of eligible) {
      const response = await fetch(`./api/token/${note.asset}`);
      const metadata = response.ok ? await response.json() : { name: "Unknown token", symbol: `${note.asset.slice(0, 6)}…`, decimals: 0 };
      const asset = { address: note.asset, name: metadata.name, symbol: metadata.symbol, decimals: metadata.decimals, balance: String(note.amount) };
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wallet-asset";
      const identity = document.createElement("span");
      const symbol = document.createElement("b"); symbol.textContent = asset.symbol;
      const name = document.createElement("small"); name.textContent = asset.name;
      const balance = document.createElement("strong"); balance.textContent = formatTokenAmount(asset.balance, asset.decimals);
      identity.append(symbol, name); button.append(identity, balance);
      button.addEventListener("click", () => {
        swapPrivateAssetsList.querySelector(".selected")?.classList.remove("selected");
        button.classList.add("selected");
        selectedWalletBalance = asset;
        if (swapDirection === "sell") {
          token.value = asset.address;
          token.dispatchEvent(new Event("change"));
        }
        amount.value = formatTokenAmount(asset.balance, asset.decimals);
        amount.dispatchEvent(new Event("input"));
        swapPrivateAssetsStatus.textContent = `${asset.symbol} private note selected. This balance will trade directly from the Private Portfolio.`;
      });
      swapPrivateAssetsList.append(button);
    }
    swapPrivateAssetsStatus.textContent = eligible.length
      ? `${eligible.length} spendable private note${eligible.length === 1 ? "" : "s"} available. Choose one to trade it directly.`
      : swapDirection === "buy"
        ? "No private notes match the selected base asset. Choose Connected Wallet or add that asset to your Private Portfolio."
        : "No spendable private notes are available. Choose Connected Wallet to sell a public wallet balance.";
  } catch (error) {
    swapPrivateAssetsStatus.textContent = error?.message || "Could not open private balances.";
  } finally {
    swapPrivateRefresh.disabled = false;
  }
}
swapPrivateRefresh.addEventListener("click", () => void loadPrivateSwapAssets());

function refreshSwapFundingSource() {
  const inSwap = activeAction === "swap";
  const usePortfolio = inSwap && swapSource === "portfolio";
  const showWalletSellBalances = inSwap && swapSource === "wallet" && swapDirection === "sell";
  swapPrivateAssets.hidden = !usePortfolio;
  walletAssets.hidden = !(activeAction === "shield" || showWalletSellBalances);
  walletAssetsTitle.textContent = activeAction === "shield" ? "Tokens in your connected wallet" : "Tokens available to sell";
  const showShortcuts = activeAction === "shield" || showWalletSellBalances;
  amountHalf.hidden = !showShortcuts;
  amountMax.hidden = !showShortcuts;
  if (inSwap) swapPrerequisite.textContent = usePortfolio
    ? "Choose an exact private note above. ZKTX trades it directly without returning it to your public wallet."
    : "Choose a connected-wallet balance. ZKTX shields the selected amount automatically, then opens the swap.";
  selectedWalletBalance = null;
  if (showWalletSellBalances) void loadWalletAssets();
}

let quoteRequest = 0;
async function updateDexQuote() {
  if (activeAction === "swap") submit.disabled = true;
  if (activeAction !== "swap" || !payTokenMeta || !receiveTokenMeta || !amount.value.trim()) return;
  const deviation = Number(priceDeviation.value);
  if (!Number.isFinite(deviation) || deviation < 0.1 || deviation > 25) {
    receiveAmount.value = "";
    receiveAmountUnits.textContent = "Choose a deviation between 0.1% and 25%.";
    receiveAmountUnits.className = "token-meta error";
    return;
  }
  const request = ++quoteRequest;
  submit.disabled = true;
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
    const payUnits = parseTokenAmount(amount.value, payTokenMeta.decimals);
    const buying = swapDirection === "buy";
    const routeInput = buying ? payUnits * 9_850n / 10_000n : payUnits;
    const routeResponse = await fetch("./api/swap-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenIn: token.value, tokenOut: receiveToken.value, amountIn: String(routeInput) }) });
    const routeQuote = await routeResponse.json();
    if (!routeResponse.ok) throw new Error(routeQuote.error || "Live route quote unavailable");
    const grossRouteOutput = BigInt(routeQuote.amountOut);
    const netRouteOutput = buying ? grossRouteOutput : grossRouteOutput * 9_850n / 10_000n;
    const routeOutput = Number(formatTokenAmount(netRouteOutput, receiveTokenMeta.decimals));
    const unfavorableDeviation = Math.max(0, (marketOutput - routeOutput) / marketOutput * 100);
    if (request !== quoteRequest) return;
    receiveAmount.value = protectedOutput.toFixed(Math.min(receiveTokenMeta.decimals, 12)).replace(/0+$/, "").replace(/\.$/, "");
    const executable = unfavorableDeviation <= deviation;
    const movement = routeOutput >= marketOutput ? `${Math.abs((routeOutput - marketOutput) / marketOutput * 100).toFixed(2)}% favorable` : `${unfavorableDeviation.toFixed(2)}% worse`;
    receiveAmountUnits.textContent = `Dexscreener reference: ${marketOutput.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${receiveTokenMeta.symbol}. Live route: ${routeOutput.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${receiveTokenMeta.symbol} (${movement}). ${executable ? `Protected minimum: ${receiveAmount.value} ${receiveTokenMeta.symbol}.` : `This exceeds your ${deviation}% limit, so submission is blocked.`}`;
    receiveAmountUnits.className = executable ? "token-meta loaded" : "token-meta error";
    submit.disabled = !executable;
  } catch (error) {
    if (request !== quoteRequest) return;
    receiveAmount.value = "";
    submit.disabled = true;
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

bulkUnshield.addEventListener("click", async () => {
  const recipient = bulkUnshieldRecipient.value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    result.textContent = "Enter one valid destination wallet for the bulk unshield.";
    return;
  }
  try {
    if (!connected || !account) throw new Error("Connect your wallet before unshielding");
    const privateNoteKey = await notePassword();
    const notes = await window.ZKTXWallet.privatePortfolio(privateNoteKey);
    if (!notes.length) throw new Error("There are no spendable private notes to unshield");
    if (!window.confirm(`Unshield all ${notes.length} private notes to ${recipient}?`)) return;
    bulkUnshield.disabled = true;
    startActivity();
    activityState.textContent = "Bulk unshield";
    logActivity(`Starting bulk unshield of ${notes.length} private notes.`);
    let completed = 0;
    for (const [index, note] of notes.entries()) {
      try {
        logActivity(`Unshielding note ${index + 1} of ${notes.length}.`);
        const withdrawal = await window.ZKTXWallet.withdrawLive({
          chainId: protocol.chainId,
          vaultAddress: protocol.vaultAddress,
          asset: note.asset,
          amount: BigInt(note.amount),
          recipient,
          password: privateNoteKey,
          onProgress: (message, details) => logActivity(message, "done", details),
        });
        completed += 1;
        logActivity(`Note ${index + 1} unshielded.`, "success", { transactionHash: withdrawal.transactionHash });
      } catch (error) {
        logActivity(`Note ${index + 1} failed: ${error?.message || "Unknown withdrawal error"}`, "error");
      }
    }
    refreshLocalNotes();
    await showPortfolio();
    activityState.textContent = completed === notes.length ? "Complete" : "Partial";
    result.textContent = completed === notes.length
      ? `All ${completed} private notes were unshielded to ${recipient}.`
      : `${completed} of ${notes.length} private notes were unshielded. Review the execution log for any failures.`;
  } catch (error) {
    activityState.textContent = "Failed";
    logActivity(error?.message || "Bulk unshield failed.", "error");
    result.textContent = error?.message || "Could not complete the bulk unshield.";
  } finally {
    bulkUnshield.disabled = false;
  }
});

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
  if (swapDirection === "buy") { token.value = address; token.disabled = true; receiveToken.disabled = false; tokenLabel.textContent = "You pay with"; priceProtectionCopy.innerHTML = "<b>Buy protection:</b> A cheaper price is always accepted. The order is blocked only when the live price is higher than your selected limit."; }
  else { receiveToken.value = address; receiveToken.disabled = true; token.disabled = false; tokenLabel.textContent = "Token you sell"; priceProtectionCopy.innerHTML = "<b>Sell protection:</b> A higher price is always accepted. The order is blocked only when the live price is lower than your selected limit."; }
  swapPrivateAssetsList.replaceChildren();
  swapPrivateAssetsStatus.textContent = "Load your spendable private balances for this trade direction.";
  token.dispatchEvent(new Event("change")); receiveToken.dispatchEvent(new Event("change"));
  refreshSwapFundingSource();
}
document.querySelectorAll(".swap-direction button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".swap-direction .selected")?.classList.remove("selected"); button.classList.add("selected"); swapDirection = button.dataset.direction; applySwapDirection();
}));
document.querySelectorAll(".quote-assets button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".quote-assets .selected")?.classList.remove("selected"); button.classList.add("selected"); applySwapDirection();
}));
document.querySelectorAll(".swap-source button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".swap-source .selected")?.classList.remove("selected");
  button.classList.add("selected");
  swapSource = button.dataset.source;
  refreshSwapFundingSource();
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
  if (activeAction === "swap") swapPrerequisite.textContent = swapSource === "portfolio"
    ? "Choose an exact private note above. ZKTX trades it directly without returning it to your public wallet."
    : "Choose a connected-wallet balance. ZKTX shields the selected amount automatically, then opens the swap.";
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
  portfolioPanel.hidden = button.dataset.tab !== "portfolio";
  const receiveMode = button.dataset.tab === "receive";
  const portfolioMode = button.dataset.tab === "portfolio";
  tokenField.hidden = receiveMode || portfolioMode;
  amountField.hidden = receiveMode || portfolioMode;
  actionCard.hidden = receiveMode || portfolioMode;
  submit.hidden = receiveMode || portfolioMode;
  refreshSwapFundingSource();
  submit.disabled = button.dataset.tab === "swap";
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
  void loadWalletAssets();
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
    if (activeAction === "shield" || (activeAction === "swap" && swapSource === "wallet" && swapDirection === "sell")) await loadWalletAssets();
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
      startActivity();
      logActivity("Preparing the private withdrawal.");
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
        onProgress: (message, details) => { result.textContent = message; logActivity(message, "done", details); },
      });
      refreshLocalNotes();
      activityState.textContent = "Complete";
      logActivity("Withdrawal confirmed.", "success", { transactionHash: withdrawal.transactionHash });
      result.innerHTML = `Tokens unshielded to ${recipient.slice(0, 8)}… <a href="https://robinhoodchain.blockscout.com/tx/${withdrawal.transactionHash}" target="_blank" rel="noopener">View withdrawal ↗</a>`;
    } catch (error) { activityState.textContent = "Failed"; logActivity(error?.message || "Withdrawal failed.", "error"); result.textContent = error?.message || "Could not unshield the private note."; }
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
      if (swapSource === "wallet") {
        logActivity("Shielding the selected connected-wallet balance before trading.");
        await window.ZKTXWallet.shieldLive({
          account, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress,
          asset: token.value, amount: payUnits, password: privateNoteKey,
          onProgress: (message, details) => { logActivity(message, "done", details); },
        });
        logActivity("Private swap balance ready. Opening the order.", "success");
        submittedOrder = orderInput();
        order = await window.ZKTXWallet.openMarketOrderLive(submittedOrder);
      } else {
        try {
          order = await window.ZKTXWallet.openMarketOrderLive(submittedOrder);
        } catch (error) {
          if (String(error?.message || "").includes("No unspent local note exactly matches")) {
            throw new Error("Choose an exact Private Portfolio note, or switch Trade from to Connected Wallet");
          }
          throw error;
        }
      }
      refreshLocalNotes();
      logActivity("Private order relayed to the execution vault.");
      const executed = await monitorMarketOrder(order.orderId, submittedOrder.deadline);
      logActivity(executed.slicesExecuted === 0 ? `Order closed without a fill. 0 of ${executed.sliceCount} slices executed.` : `Swap execution finished. ${executed.slicesExecuted} of ${executed.sliceCount} slices confirmed.`, executed.slicesExecuted === 0 ? "error" : "success");
      activityState.textContent = "Auto claiming";
      const unfilledInput = BigInt(executed.amountIn) - BigInt(executed.executedInput);
      logActivity(executed.slicesExecuted === 0 ? "Execution window expired without a fill. Starting a full refund." : unfilledInput > 0n ? "Execution window closed with a partial fill. Claiming proceeds and refunding the unused input." : "All slices executed. Claiming proceeds automatically.");
      const settled = await window.ZKTXWallet.settleMarketOrderLive({
        orderId: order.orderId,
        password: privateNoteKey,
        onProgress: (message, details) => logActivity(message, "done", details),
      });
      refreshLocalNotes();
      activityState.textContent = executed.slicesExecuted === 0 ? "Refunded" : "Complete";
      logActivity(executed.slicesExecuted === 0 ? "Refund confirmed. Input balance restored to the private portfolio." : unfilledInput > 0n ? "Settlement confirmed. Proceeds and unused input added to the private portfolio." : "Settlement confirmed. Swap proceeds added to the private portfolio.", "success", { transactionHash: settled.transactionHash });
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
    startActivity();
    logActivity("Preparing the shielded deposit.");
    if (!connected || !account) throw new Error("Connect your wallet before shielding");
    if (!protocol.contractsReady) throw new Error("The experimental live vault is not ready");
    const live = await window.ZKTXWallet.shieldLive({
      account, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress,
      asset: token.value, amount: payUnits, password: await notePassword(),
      onProgress: (message, details) => { result.textContent = message; logActivity(message, "done", details); },
    });
    refreshLocalNotes();
    activityState.textContent = "Complete";
    logActivity("Shielded deposit confirmed.", "success", { transactionHash: live.depositHash });
    result.innerHTML = live.indexed
      ? `Shielded deposit confirmed and ready to use. Commitment ${live.record.commitment.slice(0, 12)}… <a href="https://robinhoodchain.blockscout.com/tx/${live.depositHash}" target="_blank" rel="noopener">View transaction ↗</a>`
      : `Shielded deposit confirmed onchain. The private balance is still syncing, so wait a few seconds before swapping. <a href="https://robinhoodchain.blockscout.com/tx/${live.depositHash}" target="_blank" rel="noopener">View transaction ↗</a>`;
    const destination = document.querySelector(`.tabs button[data-tab="${returnAfterShield}"]`);
    if (destination) selectTab(destination);
  } catch (error) {
    activityState.textContent = "Failed";
    logActivity(error?.message || "Shielded deposit failed.", "error");
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
  } catch (error) { activityState.textContent = "Failed"; logActivity(error?.message || "Settlement or refund failed.", "error"); result.textContent = error?.message || "Could not settle the market order."; }
});

activityAction.addEventListener("click", () => settleMarket.click());
