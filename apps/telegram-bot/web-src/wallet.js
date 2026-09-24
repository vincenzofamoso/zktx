import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

globalThis.ZKTX_RUNTIME_CONFIG = { apiBase: "https://zktx.tech", provingBase: "https://zktx.tech/proving" };
const walletModule = await import("../../../client/wallet.js");
const { shieldLive, openMarketOrderLive, settleMarketOrderLive, privatePortfolio, storedMarketOrders } = walletModule;

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const params = new URL(location.href).searchParams;
const action = params.get("action") || "wallet";
const jobId = params.get("job") || "";
const iterations = 600_000;
const utf8 = new TextEncoder();
const databaseName = "zktx-trusted-device-v1";
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://zktx.tech/api/rpc"] } } };
const transport = http(chain.rpcUrls.default.http[0], { retryCount: 2 });
const publicClient = createPublicClient({ chain, transport });
const encode = (bytes) => btoa(String.fromCharCode(...bytes));
const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const status = (text) => document.querySelector("#status").textContent = text;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let activeAccount;
let activeJob;
let activeOrderId;
let setupAccount;
let automaticNotePassword;

async function notePassword(legacySelector) {
  const legacy = document.querySelector(legacySelector)?.value?.trim();
  if (legacy?.length >= 10) return legacy;
  if (!activeAccount) throw new Error("Unlock your wallet first");
  if (automaticNotePassword) return automaticNotePassword;
  const signature = await activeAccount.signMessage({ message: `ZKTX private notes v1\nRobinhood Chain\n${activeAccount.address.toLowerCase()}` });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(signature)));
  automaticNotePassword = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return automaticNotePassword;
}

async function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedKey(address) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("keys", "readonly").objectStore("keys").get(address.toLowerCase());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function saveKey(address, key) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const request = database.transaction("keys", "readwrite").objectStore("keys").put(key, address.toLowerCase());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function derive(passphrase, vault) {
  if (passphrase.length < 12) throw new Error("Use a recovery passphrase with at least 12 characters");
  const material = await crypto.subtle.importKey("raw", utf8.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: decode(vault.salt), iterations: vault.kdfIterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encrypt(secret, passphrase) {
  const normalized = secret.startsWith("0x") ? secret : `0x${secret}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("Enter a valid EVM private key");
  const account = privateKeyToAccount(normalized);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, { salt: encode(salt), kdfIterations: iterations });
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(`ZKTX:${account.address}:1`) }, key, utf8.encode(normalized)));
  return { account, key, envelope: { version: 1, address: account.address, ciphertext: encode(ciphertext), iv: encode(iv), salt: encode(salt), kdf: "PBKDF2-SHA256", kdfIterations: iterations } };
}

async function decryptVault(vault, key) {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(vault.iv), additionalData: utf8.encode(`ZKTX:${vault.address}:1`) }, key, decode(vault.ciphertext));
  const account = privateKeyToAccount(new TextDecoder().decode(clear));
  if (account.address.toLowerCase() !== vault.address.toLowerCase()) throw new Error("Vault address mismatch");
  return account;
}

async function api(path, options = {}) {
  if (!tg?.initData) throw new Error("Open this page from the ZKTX Telegram bot");
  const response = await fetch(`/telegram-api${path}`, { ...options, headers: { "content-type": "application/json", "x-telegram-init-data": tg.initData, ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Secure wallet request failed");
  return payload;
}

async function tokenMetadata(address) {
  const response = await fetch(`https://zktx.tech/api/token/${address}`);
  const metadata = await response.json();
  if (!response.ok) throw new Error(metadata.error || "Token metadata unavailable");
  return metadata;
}

async function tokenUnits(address, amount) {
  const metadata = await tokenMetadata(address);
  const value = String(amount);
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid token amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > metadata.decimals) throw new Error(`Amount has more than ${metadata.decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(metadata.decimals) + BigInt((fraction + "0".repeat(metadata.decimals)).slice(0, metadata.decimals) || "0");
}

function formatUnits(value, decimals) {
  const padded = BigInt(value).toString().padStart(decimals + 1, "0");
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

function installLocalSigner(account) {
  const wallet = createWalletClient({ account, chain, transport });
  window.ethereum = { request: async ({ method, params: rpcParams = [] }) => {
    if (method === "eth_chainId") return `0x${chain.id.toString(16)}`;
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [account.address];
    if (method === "eth_call" || method === "eth_getTransactionReceipt") return publicClient.request({ method, params: rpcParams });
    if (method === "eth_sendTransaction") {
      const transaction = rpcParams[0] || {};
      return wallet.sendTransaction({ account, to: transaction.to, data: transaction.data, value: transaction.value ? BigInt(transaction.value) : undefined });
    }
    return publicClient.request({ method, params: rpcParams });
  } };
}

function startTerminal() {
  document.querySelector("#execution-terminal").hidden = false;
  document.querySelector("#execution-lines").replaceChildren();
  document.querySelector("#execution-state").textContent = "RUNNING";
}

function log(message, kind = "normal", details = {}) {
  const lines = document.querySelector("#execution-lines");
  const row = document.createElement("div");
  row.className = `terminal-line ${kind}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const marker = document.createElement("i");
  marker.textContent = kind === "error" ? "×" : kind === "success" ? "✓" : ">";
  const text = document.createElement("span");
  if (details.transactionHash) {
    const link = document.createElement("a");
    link.href = `https://robinhoodchain.blockscout.com/tx/${details.transactionHash}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${message} · View transaction ↗`;
    text.append(link);
  } else text.textContent = message;
  row.append(time, marker, text);
  lines.append(row);
  lines.scrollTop = lines.scrollHeight;
}

async function monitorOrder(orderId) {
  let lastSlices = -1;
  const linkedSlices = new Set();
  for (;;) {
    const response = await fetch(`https://zktx.tech/api/market/order/${orderId}`, { cache: "no-store" });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || "Could not load the market order");
    const slices = Number(order.slicesExecuted);
    const total = Number(order.sliceCount);
    for (const [index, transactionHash] of (order.sliceTransactions || []).entries()) {
      if (linkedSlices.has(transactionHash)) continue;
      linkedSlices.add(transactionHash);
      log(`Execution slice ${index + 1} confirmed`, "normal", { transactionHash });
    }
    if (slices !== lastSlices) {
      log(slices ? `Execution slice ${slices} of ${total} confirmed` : `Order accepted. Waiting for ${total} execution slices`);
      lastSlices = slices;
    }
    const now = Math.floor(Date.now() / 1000);
    const complete = BigInt(order.executedInput) >= BigInt(order.amountIn);
    const readyAt = complete ? Number(order.lastExecutionAt) + 30 : Number(order.deadline) + 30;
    if (!complete) {
      const remaining = Math.max(0, Number(order.deadline) - now);
      document.querySelector("#execution-state").textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} LEFT`;
    }
    if ((complete || now >= Number(order.deadline)) && now >= readyAt) return order;
    if (complete) document.querySelector("#execution-state").textContent = `CLAIMING IN ${Math.max(0, readyAt - now)}S`;
    await delay(2_500);
  }
}

async function settle(orderId, password, job = null) {
  document.querySelector("#execution-state").textContent = "CLAIMING";
  const result = await settleMarketOrderLive({ orderId, password, onProgress: (message, details) => log(message, "normal", details) });
  log("Proceeds added to your Shielded Portfolio", "success");
  document.querySelector("#execution-state").textContent = "COMPLETE";
  document.querySelector("#claim").hidden = true;
  if (job) await api(`/api/v1/jobs/${encodeURIComponent(job.id)}/settle`, { method: "POST", body: JSON.stringify({ orderId, transactionHash: result.transactionHash }) });
  return result;
}

async function execute(job) {
  const password = await notePassword("#legacy-review-password");
  installLocalSigner(activeAccount);
  const protocol = await (await fetch("https://zktx.tech/api/status", { cache: "no-store" })).json();
  if (job.type === "shield") {
    const result = await shieldLive({ account: activeAccount.address, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress, asset: job.token, amount: await tokenUnits(job.token, job.amount), password, onProgress: (message, details) => log(message, "normal", details) });
    return { transactionHash: result.depositHash, approvalHash: result.approvalHash };
  }
  if (job.type === "market") {
    const amountIn = await tokenUnits(job.token, job.amount);
    const minimumAmountOut = await tokenUnits(job.receiveToken, job.receiveAmount);
    const orderInput = () => ({ chainId: protocol.chainId, vaultAddress: protocol.vaultAddress, assetIn: job.token, amountIn, assetOut: job.receiveToken, minimumAmountOut, deadline: BigInt(Math.floor(Date.now() / 1000) + Number(job.deadlineSeconds)), password, onProgress: (message, details) => log(message, "normal", details) });
    let result;
    try {
      result = await openMarketOrderLive(orderInput());
    } catch (error) {
      if (!String(error?.message || "").includes("No unspent local note exactly matches")) throw error;
      log("No matching private balance found. Preparing it from the wallet now.");
      await shieldLive({ account: activeAccount.address, chainId: protocol.chainId, vaultAddress: protocol.vaultAddress, asset: job.token, amount: amountIn, password, onProgress: (message, details) => log(message, "normal", details) });
      log("Private swap balance is ready. Opening the order.", "success");
      result = await openMarketOrderLive(orderInput());
    }
    return { transactionHash: result.transactionHash, orderId: result.orderId };
  }
  throw new Error("This action does not yet have a live trusted-device executor");
}

function showOnly(id) {
  for (const selector of ["#import", "#backup", "#unlock", "#wallet", "#review", "#dashboard"]) document.querySelector(selector).hidden = selector !== id;
}

function randomHex(bytes = 32) {
  return `0x${[...crypto.getRandomValues(new Uint8Array(bytes))].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function storeNewWallet(secret, showPrivateKey) {
  const normalized = secret.startsWith("0x") ? secret : `0x${secret}`;
  status("Encrypting the wallet on this device...");
  const result = await encrypt(normalized, normalized);
  await api("/api/v1/vault", { method: "PUT", body: JSON.stringify(result.envelope) });
  await saveKey(result.account.address, result.key);
  if (showPrivateKey) {
    setupAccount = result.account;
    document.querySelector("#recovery-code").textContent = normalized;
    document.querySelector("#created-address").textContent = result.account.address;
    showOnly("#backup");
    status("Wallet created. Copy the private key before continuing.");
  } else {
    await ready(result.account);
    status("Wallet imported and encrypted on this device.");
  }
}

async function loadDashboard() {
  const password = await notePassword("#legacy-dashboard-password");
  const output = document.querySelector("#dashboard-output");
  output.replaceChildren();
  const notes = await privatePortfolio(password);
  const grouped = new Map();
  for (const note of notes) {
    const key = note.asset.toLowerCase();
    const group = grouped.get(key) || { asset: note.asset, total: 0n, notes: [] };
    group.total += BigInt(note.amount); group.notes.push(note); grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    const metadata = await tokenMetadata(group.asset).catch(() => ({ symbol: `${group.asset.slice(0, 6)}...`, decimals: 0 }));
    const row = document.createElement("div"); row.className = "portfolio-row";
    const title = document.createElement("b"); title.textContent = `${formatUnits(group.total, metadata.decimals)} ${metadata.symbol}`;
    const copy = document.createElement("small"); copy.textContent = `${group.notes.length} spendable private note${group.notes.length === 1 ? "" : "s"}`;
    row.append(title, copy); output.append(row);
  }
  for (const order of storedMarketOrders().filter((entry) => !entry.settled)) {
    const row = document.createElement("div"); row.className = "portfolio-row";
    const title = document.createElement("b"); title.textContent = "Pending Shielded Swap";
    const copy = document.createElement("small"); copy.textContent = `${order.orderId.slice(0, 12)}...`;
    const button = document.createElement("button"); button.textContent = "Check and claim";
    button.onclick = async () => { button.disabled = true; try { startTerminal(); await monitorOrder(order.orderId); log("Swap complete. Settlement is ready", "success"); await settle(order.orderId, password); await loadDashboard(); } catch (error) { log(error.message || "Claim failed", "error"); button.disabled = false; } };
    row.append(title, copy, button); output.append(row);
  }
  if (!output.children.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No shielded tokens or pending swaps found for this password."; output.append(empty); }
}

async function ready(account) {
  activeAccount = account;
  automaticNotePassword = undefined;
  document.querySelector("#import").hidden = true;
  document.querySelector("#unlock").hidden = true;
  document.querySelector("#wallet").hidden = false;
  document.querySelector("#address").textContent = account.address;
  if (action === "authorize") {
    document.querySelector("#screen-title").textContent = "Review transaction";
    const { message, job } = await api(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    activeJob = job;
    document.querySelector("#review").hidden = false;
    document.querySelector("#summary").textContent = message;
    const button = document.querySelector("#authorize");
    button.hidden = false;
    button.onclick = async () => {
      button.disabled = true;
      startTerminal();
      try {
        log("Trusted device unlocked");
        const execution = await execute(job);
        await api(`/api/v1/jobs/${encodeURIComponent(job.id)}/complete`, { method: "POST", body: JSON.stringify(execution) });
        if (execution.orderId) {
          activeOrderId = execution.orderId;
          log("Private order confirmed onchain", "success");
          const completed = await monitorOrder(execution.orderId);
          log(completed.slicesExecuted === 0 ? `Order closed without a fill. 0 of ${completed.sliceCount} slices executed. Restoring your input balance.` : `Swap execution finished. ${completed.slicesExecuted} of ${completed.sliceCount} slices confirmed. Adding proceeds to your Shielded Portfolio.`, completed.slicesExecuted === 0 ? "error" : "success");
          await settle(execution.orderId, await notePassword("#legacy-review-password"), activeJob);
          status(completed.slicesExecuted === 0 ? "Input balance restored automatically." : "Swap complete. Proceeds are in your Shielded Portfolio.");
        } else {
          log("Shielded balance updated", "success");
          document.querySelector("#execution-state").textContent = "COMPLETE";
          status("Executed successfully. Return to Telegram for the receipt.");
        }
        tg?.HapticFeedback?.notificationOccurred("success");
      } catch (error) {
        log(error.shortMessage || error.message || "Execution failed", "error");
        document.querySelector("#execution-state").textContent = "ACTION NEEDED";
        button.disabled = false;
        tg?.HapticFeedback?.notificationOccurred("error");
      }
    };
    document.querySelector("#claim").onclick = async () => {
      const claim = document.querySelector("#claim"); claim.disabled = true;
      try { await settle(activeOrderId, await notePassword("#legacy-review-password"), activeJob); status("Claim complete. Your proceeds are in the Shielded Portfolio."); }
      catch (error) { log(error.message || "Claim failed", "error"); claim.disabled = false; }
    };
    status("Review the action, then press the yellow button. Your wallet handles the private-note key automatically.");
  } else {
    document.querySelector("#dashboard").hidden = false;
    status("Wallet unlocked. Load your local Shielded Portfolio or resume a pending swap.");
  }
}

async function bootstrap() {
  if (action === "import") { showOnly("#import"); status("Create a new encrypted wallet, or optionally import one private key."); return; }
  try {
    const { vault } = await api("/api/v1/vault");
    const key = await storedKey(vault.address);
    if (!key) { showOnly("#unlock"); status("Unlock the wallet already imported for this Telegram account."); return; }
    await ready(await decryptVault(vault, key));
  } catch (error) {
    if (String(error.message).includes("Wallet not found")) { showOnly("#import"); status("Import a wallet once, then this transaction will continue automatically."); }
    else { showOnly("#unlock"); status("Unlock the wallet already imported for this Telegram account."); }
  }
}

document.querySelector("#refresh-dashboard").onclick = async () => { try { await loadDashboard(); } catch (error) { status(error.message || "Could not load portfolio"); } };
document.querySelector("#create-wallet").onclick = async () => { try { await storeNewWallet(randomHex(), true); } catch (error) { status(error.message || "Wallet creation failed"); } };
document.querySelector("#import-existing").onsubmit = async (event) => { event.preventDefault(); const secret = document.querySelector("#private-key"); try { await storeNewWallet(secret.value.trim(), false); secret.value = ""; } catch (error) { secret.value = ""; status(error.message || "Import failed"); } };
document.querySelector("#copy-recovery").onclick = async () => { await navigator.clipboard?.writeText(document.querySelector("#recovery-code").textContent); status("Private key copied. Store it somewhere safe."); };
document.querySelector("#copy-created-address").onclick = async () => { await navigator.clipboard?.writeText(document.querySelector("#created-address").textContent); status("Wallet address copied. Fund it on Robinhood Chain and keep some RH ETH for gas."); };
document.querySelector("#copy-address").onclick = async () => { await navigator.clipboard?.writeText(document.querySelector("#address").textContent); status("Wallet address copied. Fund it on Robinhood Chain and keep some RH ETH for gas."); };
document.querySelector("#finish-setup").onclick = async () => { if (!setupAccount) return; await ready(setupAccount); };
document.querySelector("#unlock").onsubmit = async (event) => { event.preventDefault(); const passphrase = document.querySelector("#unlock-passphrase"); try { const { vault } = await api("/api/v1/vault"), entered = passphrase.value.trim(), credential = /^[0-9a-fA-F]{64}$/.test(entered) ? `0x${entered}` : entered, key = await derive(credential, vault); passphrase.value = ""; const account = await decryptVault(vault, key); await saveKey(vault.address, key); document.querySelector("#unlock").hidden = true; await ready(account); } catch { passphrase.value = ""; status("Wallet unlock failed. Check the private key or legacy recovery code."); } };
void bootstrap();
