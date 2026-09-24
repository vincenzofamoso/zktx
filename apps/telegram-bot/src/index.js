import { Bot, InlineKeyboard } from "grammy";
import express from "express";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeEventLog, getAddress, isAddress, verifyMessage } from "viem";
import { parseEncryptedWalletEnvelope, verifyTelegramInitData } from "./security.js";
import { vaultAbi } from "../../../src/vault-abi.js";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  || (process.env.TELEGRAM_BOT_TOKEN_FILE ? (await readFile(process.env.TELEGRAM_BOT_TOKEN_FILE, "utf8")).trim() : "");
if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN_FILE");
const stateDir = path.resolve(process.env.ZKTX_BOT_STATE_DIR || "/var/lib/zktx-telegram-bot");
const stateFile = path.join(stateDir, "state.json");
const signerUrl = (process.env.ZKTX_SIGNER_URL || "https://zktx.tech/telegram/").replace(/\/+$/, "") + "/";
const protocolUrl = (process.env.ZKTX_PROTOCOL_URL || "https://zktx.tech").replace(/\/+$/, "");
const rpcUrl = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const port = Number(process.env.PORT || 3540);
const allowedChats = new Set((process.env.ALLOWED_CHAT_IDS || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number).filter(Number.isSafeInteger));
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const baseAssets = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
};
let store = { vaults: {}, drafts: {}, jobs: [] };
await mkdir(stateDir, { recursive: true, mode: 0o700 });
try { store = { ...store, ...JSON.parse(await readFile(stateFile, "utf8")) }; } catch {}
store.vaults ||= {}; store.drafts ||= {}; store.jobs ||= [];

async function save() {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, stateFile);
}
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const permitted = (ctx) => Boolean(ctx.chat && (!allowedChats.size || allowedChats.has(ctx.chat.id)));
const draftFor = (ctx) => ctx.chat ? store.drafts[String(ctx.chat.id)] : null;
const vaultFor = (ctx) => ctx.from ? store.vaults[String(ctx.from.id)] : null;
const signerLink = (query) => `${signerUrl}?v=4&${query}`;
const signerButton = (label, query) => new InlineKeyboard().webApp(label, signerLink(query));

function homeKeyboard(userId) {
  const keyboard = new InlineKeyboard()
    .text("Private Swap", "flow:market")
    .webApp("Portfolio", signerLink("action=wallet")).row();
  if (store.vaults[String(userId)]) keyboard.webApp("Wallet settings", signerLink("action=wallet"));
  else keyboard.webApp("Create or import wallet", signerLink("action=import"));
  return keyboard;
}

function startDraft(ctx, type) {
  if (!ctx.chat || !ctx.from) return null;
  if (type !== "market") return ctx.reply("Use /trade to start a Private Swap.");
  const vault = vaultFor(ctx);
  if (!vault) return ctx.reply("Set up your Trusted Device Wallet before creating ZKTX actions.", { reply_markup: signerButton("Set Up Wallet", "action=import") });
  const firstStep = type === "market" ? "direction" : type === "send" || type === "withdraw" ? "recipient" : "token";
  store.drafts[String(ctx.chat.id)] = { id: randomBytes(8).toString("hex"), type, step: firstStep, userId: ctx.from.id, chatId: ctx.chat.id, wallet: vault.address, createdAt: new Date().toISOString() };
  const prompt = firstStep === "direction"
    ? "Do you want to buy a token or sell a token?"
    : firstStep === "recipient"
    ? type === "send" ? "Send the recipient's ZKTX private receive address. They can copy it from their Shielded Portfolio." : "Send the destination Robinhood Chain wallet address."
    : type === "market"
      ? "Send the contract address of the Robinhood Chain token you want to swap."
      : "Send the Robinhood Chain token contract address.";
  const options = firstStep === "direction"
    ? { reply_markup: new InlineKeyboard().text("Buy token", "swap-direction:buy").text("Sell token", "swap-direction:sell") }
    : undefined;
  return save().then(() => ctx.reply(prompt, options));
}

function jobMessage(job) {
  const lines = [`Action: ${job.type === "market" ? "shielded swap" : job.type === "withdraw" ? "unshield" : job.type}`, `Wallet: ${job.wallet}`, ...(job.direction ? [`Direction: ${job.direction}`] : []), ...(job.baseAsset ? [`Base asset: ${job.baseAsset.toUpperCase()}`] : []), ...(job.token ? [`Pay token: ${job.token}`] : []), ...(job.receiveToken ? [`Receive token: ${job.receiveToken}`] : []), ...(job.amount ? [`Amount: ${job.amount}`] : []), ...(job.receiveAmount ? [`Minimum received: ${job.receiveAmount}`] : []), ...(job.deadlineSeconds ? [`Execution deadline: ${job.deadlineSeconds} seconds`] : []), ...(job.recipient ? [`Destination: ${job.recipient}`] : [])];
  return `ZKTX Telegram authorization\nJob: ${job.id}\n${lines.join("\n")}\nExpires: ${job.expiresAt}`;
}

async function protocolStatus() {
  try {
    const response = await fetch(`${protocolUrl}/api/status`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { return null; }
}

async function verifiedVaultReceipt(transactionHash, expected = {}) {
  const [receiptResponse, readiness] = await Promise.all([
    fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [transactionHash] }), signal: AbortSignal.timeout(10_000) }),
    protocolStatus(),
  ]);
  const receipt = (await receiptResponse.json()).result;
  if (!receipt || BigInt(receipt.status || 0) !== 1n) throw new Error("Transaction is not confirmed successfully");
  if (!readiness?.vaultAddress || receipt.to?.toLowerCase() !== readiness.vaultAddress.toLowerCase()) throw new Error("Transaction did not execute against the active ZKTX vault");
  if (expected.eventName) {
    const event = receipt.logs?.map((log) => {
      try { return decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics, strict: false }); } catch { return null; }
    }).find((entry) => entry?.eventName === expected.eventName && (!expected.orderId || String(entry.args?.orderId).toLowerCase() === expected.orderId.toLowerCase()));
    if (!event) throw new Error(`Transaction does not contain the expected ${expected.eventName} event`);
  }
  return receipt;
}

function executionUrl(job) {
  const query = new URLSearchParams({ tab: job.type === "market" ? "swap" : job.type });
  if (job.token) query.set("token", job.token);
  if (job.amount) query.set("amount", job.amount);
  if (job.receiveToken) query.set("receiveToken", job.receiveToken);
  if (job.receiveAmount) query.set("minimum", job.receiveAmount);
  if (job.deadlineSeconds) query.set("deadline", String(job.deadlineSeconds));
  if (job.recipient) query.set("recipient", job.recipient);
  return `${protocolUrl}/app?${query}`;
}

async function finalizeDraft(ctx, draft) {
  const job = { ...draft, status: "awaiting_signature", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  delete job.step;
  store.jobs.push(job); delete store.drafts[String(draft.chatId)]; await save();
  const marketCopy = job.type === "market" ? "\nExecution uses compatible existing RH liquidity in 3 to 7 variable slices. During the capped pre-token pilot, 1% accumulates as WETH for later ZKTX buyback-and-burn and 0.5% supports execution." : "";
  await ctx.reply(["<b>Review ZKTX action</b>", "", `Type: <b>${escape(job.type === "market" ? "Shielded Swap" : job.type === "withdraw" ? "Unshield" : job.type === "send" ? "Private Send" : "Shield")}</b>`, job.direction ? `Direction: <b>${escape(job.direction === "buy" ? "Buy" : "Sell")}</b>` : "", job.baseAsset ? `Base asset: <b>${escape(job.baseAsset.toUpperCase())}</b>` : "", job.token ? `Pay token: <code>${job.token}</code>` : "", job.amount ? `Amount to spend: <code>${job.amount}</code>` : "", job.receiveToken ? `Receive token: <code>${job.receiveToken}</code>` : "", job.receiveAmount ? `Minimum received: <code>${job.receiveAmount}</code>` : "", job.recipient ? `Destination: <code>${job.recipient}</code>` : "", marketCopy, "One secure confirmation creates the proof, signs, and executes from your trusted device."].filter(Boolean).join("\n"), { parse_mode: "HTML", reply_markup: signerButton("Sign & Execute", `action=authorize&job=${encodeURIComponent(job.id)}`) });
}

const bot = new Bot(token);
bot.use(async (ctx, next) => { if (!permitted(ctx)) return ctx.reply("This bot is not enabled in this chat."); await next(); });
bot.command("start", async (ctx) => ctx.from && ctx.reply("<b>ZKTX</b>\n\nChoose Private Swap to trade, or Portfolio to view and manage private balances. Wallet setup stays on your device.", { parse_mode: "HTML", reply_markup: homeKeyboard(ctx.from.id) }));
bot.command("portfolio", async (ctx) => ctx.from && ctx.reply("<b>Private Portfolio</b>\n\nView shielded balances and resume pending swaps.", { parse_mode: "HTML", reply_markup: signerButton("Open Portfolio", "action=wallet") }));
bot.command("wallet", async (ctx) => ctx.from && ctx.reply(vaultFor(ctx) ? `<b>Wallet</b>\n<code>${vaultFor(ctx).address}</code>` : "No wallet is set up on this device.", { parse_mode: "HTML", reply_markup: vaultFor(ctx) ? signerButton("Wallet settings", "action=wallet") : signerButton("Create or import wallet", "action=import") }));
bot.command("trade", (ctx) => startDraft(ctx, "market"));
bot.command("swap", (ctx) => startDraft(ctx, "market"));
bot.command("cancel", async (ctx) => { if (ctx.chat) delete store.drafts[String(ctx.chat.id)]; await save(); await ctx.reply("Current action cancelled."); });
bot.callbackQuery("flow:market", async (ctx) => { await ctx.answerCallbackQuery(); await startDraft(ctx, "market"); });
bot.callbackQuery(/^deadline:(60|180|300|600|900)$/, async (ctx) => { await ctx.answerCallbackQuery(); const draft = draftFor(ctx); if (!draft || draft.type !== "market" || draft.step !== "deadline") return ctx.reply("That Private Swap is no longer active."); draft.deadlineSeconds = Number(ctx.match[1]); await finalizeDraft(ctx, draft); });
bot.callbackQuery(/^swap-direction:(buy|sell)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = draftFor(ctx);
  if (!draft || draft.type !== "market" || draft.step !== "direction") return ctx.reply("That Private Swap is no longer active.");
  draft.direction = ctx.match[1]; draft.step = "baseAsset"; await save();
  await ctx.reply(`Choose the base asset you want to ${draft.direction === "buy" ? "spend" : "receive"}.`, { reply_markup: new InlineKeyboard().text("WETH", "swap-base:weth").text("USDG", "swap-base:usdg") });
});
bot.callbackQuery(/^swap-base:(weth|usdg)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = draftFor(ctx);
  if (!draft || draft.type !== "market" || draft.step !== "baseAsset") return ctx.reply("That Private Swap is no longer active.");
  draft.baseAsset = ctx.match[1]; draft.step = "targetToken"; await save();
  await ctx.reply(`Send the contract address of the token you want to ${draft.direction}.`);
});
bot.on("message:text", async (ctx) => {
  const draft = draftFor(ctx); if (!draft || ctx.message.text.startsWith("/")) return;
  const text = ctx.message.text.trim();
  try {
    if (draft.step === "recipient") {
      if (draft.type === "send") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(text)) throw new Error("Send a valid ZKTX private receive address.");
        draft.recipient = text;
      } else {
        if (!isAddress(text)) throw new Error("Send a valid 0x destination address.");
        draft.recipient = getAddress(text);
      }
      draft.step = "token"; await save(); return ctx.reply("Send the token contract address.");
    }
    if (draft.step === "targetToken") { if (!addressPattern.test(text)) throw new Error("Send a valid token contract address."); const target = getAddress(text); const base = baseAssets[draft.baseAsset]; draft.token = draft.direction === "buy" ? base : target; draft.receiveToken = draft.direction === "buy" ? target : base; draft.step = "amount"; await save(); return ctx.reply(`How much ${draft.direction === "buy" ? draft.baseAsset.toUpperCase() : "of the token"} do you want to spend? Send a normal token amount, for example: 5 or 0.25`); }
    if (draft.step === "token") { if (!addressPattern.test(text)) throw new Error("Send a valid token contract address."); draft.token = getAddress(text); draft.step = "amount"; await save(); return ctx.reply("Send the amount as a normal token amount, for example: 5 or 0.25"); }
    if (draft.step === "amount") { if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error("Amount must be a positive token amount."); draft.amount = text; if (draft.type === "market") { draft.step = "receiveAmount"; await save(); return ctx.reply(`Send the minimum ${draft.direction === "buy" ? "tokens" : draft.baseAsset.toUpperCase()} you are willing to receive after fees and slippage.`); } return finalizeDraft(ctx, draft); }
    if (draft.step === "receiveToken") { if (!addressPattern.test(text)) throw new Error("Send a valid receive-token contract."); draft.receiveToken = getAddress(text); draft.step = "receiveAmount"; await save(); return ctx.reply("Send the minimum net amount you are willing to receive as a normal token amount. The 1.5% ZKTX fee must fit inside this limit."); }
    if (draft.step === "receiveAmount") { if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error("Minimum received must be positive."); draft.receiveAmount = text; draft.step = "deadline"; await save(); return ctx.reply("Choose how long the order may execute.", { reply_markup: new InlineKeyboard().text("1 min", "deadline:60").text("3 min", "deadline:180").text("5 min", "deadline:300").row().text("10 min", "deadline:600").text("15 min", "deadline:900") }); }
  } catch (error) { await ctx.reply(error.message || "Invalid input"); }
});

const app = express();
app.disable("x-powered-by"); app.use(express.json({ limit: "32kb" }));
function webUser(req) { const initData = req.get("x-telegram-init-data"); if (!initData) throw new Error("Telegram authorization required"); return verifyTelegramInitData(initData, token); }
app.get("/health", async (_req, res) => { const status = await protocolStatus(); res.json({ ok: true, protocol: status ? { contractsReady: status.contractsReady, relayerReady: status.relayerReady, marketKeeperReady: status.marketKeeperReady } : "unavailable" }); });
app.get("/api/v1/vault", (req, res) => { try { const user = webUser(req), vault = store.vaults[String(user.id)]; return vault ? res.json({ vault }) : res.status(404).json({ error: "Wallet not found" }); } catch { return res.status(401).json({ error: "Telegram authorization required" }); } });
app.put("/api/v1/vault", async (req, res) => { try { const user = webUser(req), vault = parseEncryptedWalletEnvelope(req.body); store.vaults[String(user.id)] = vault; await save(); return res.json({ address: vault.address }); } catch (error) { return res.status(400).json({ error: error.message || "Invalid encrypted wallet" }); } });
app.get("/api/v1/jobs/:id", (req, res) => { try { const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature"); if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error(); return res.json({ job, message: jobMessage(job), protocolUrl }); } catch { return res.status(404).json({ error: "Authorization job unavailable" }); } });
app.post("/api/v1/jobs/:id/authorize", async (req, res) => {
  try {
    const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature");
    if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error("Authorization expired");
    const signature = String(req.body?.signature || ""), valid = await verifyMessage({ address: job.wallet, message: jobMessage(job), signature });
    if (!valid) throw new Error("Signature did not match imported wallet");
    const readiness = await protocolStatus();
    job.status = readiness?.relayerReady && (job.type !== "market" || readiness.marketKeeperReady) ? "authorized_ready" : "authorized_gated"; job.authorizedAt = new Date().toISOString(); job.signature = signature; await save();
    const keyboard = new InlineKeyboard().webApp(job.type === "market" ? "Continue Shielded Swap" : job.type === "shield" ? "Continue Shield" : job.type === "withdraw" ? "Continue Unshield" : "Continue Private Send", executionUrl(job));
    const note = job.status === "authorized_ready" ? "Continue to generate the proof and execute." : "Authorization is saved, but execution is currently unavailable because the relayer or execution keeper is offline.";
    await bot.api.sendMessage(job.chatId, `✅ ${job.type === "market" ? "Shielded Swap" : job.type === "withdraw" ? "Unshield" : job.type === "send" ? "Private Send" : "Shield"} authorized by ${job.wallet.slice(0, 8)}…${job.wallet.slice(-6)}. ${note}`, { reply_markup: keyboard });
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Authorization failed" }); }
});
app.post("/api/v1/jobs/:id/complete", async (req, res) => {
  try {
    const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature");
    if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error("Execution job expired");
    const transactionHash = String(req.body?.transactionHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error("Invalid transaction receipt");
    const orderId = req.body?.orderId == null ? null : String(req.body.orderId);
    if (orderId && !/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new Error("Invalid market order id");
    const transferReceipt = job.type === "send" ? String(req.body?.transferReceipt || "") : "";
    if (job.type === "send" && !/^[A-Za-z0-9+/=]{100,4000}$/.test(transferReceipt)) throw new Error("Invalid private transfer receipt");
    const eventName = orderId ? "MarketOrderOpened" : job.type === "send" ? "PrivateTransfer" : "Deposit";
    await verifiedVaultReceipt(transactionHash, { eventName, orderId });
    job.status = "executed"; job.executedAt = new Date().toISOString(); job.transactionHash = transactionHash;
    if (orderId) job.orderId = orderId;
    await save();
    const explorer = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
    await bot.api.sendMessage(job.chatId, `✅ <b>${job.type === "market" ? "Shielded Swap submitted" : job.type === "send" ? "Private Send confirmed" : "Shield confirmed"}</b>\n\nTransaction: <a href="${explorer}">${transactionHash.slice(0, 12)}…${transactionHash.slice(-8)}</a>${orderId ? `\nOrder: <code>${orderId}</code>` : ""}${transferReceipt ? `\n\nSend this receipt to the recipient:\n<code>${transferReceipt}</code>` : ""}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Could not record execution" }); }
});
app.post("/api/v1/jobs/:id/settle", async (req, res) => {
  try {
    const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "executed");
    if (!job?.orderId || job.orderId !== String(req.body?.orderId || "")) throw new Error("Settlement job unavailable");
    const transactionHash = String(req.body?.transactionHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error("Invalid settlement receipt");
    await verifiedVaultReceipt(transactionHash, { eventName: "MarketOrderSettled", orderId: job.orderId });
    job.status = "settled"; job.settledAt = new Date().toISOString(); job.settlementHash = transactionHash; await save();
    const explorer = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
    await bot.api.sendMessage(job.chatId, `✅ <b>Shielded Swap claimed</b>\n\nThe proceeds are now in your Shielded Portfolio.\n<a href="${explorer}">View settlement transaction</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Could not record settlement" }); }
});
app.listen(port, "127.0.0.1", () => console.log(`ZKTX Telegram API listening on ${port}`));
bot.catch(({ error }) => console.error("ZKTX bot", error?.message || error));
await bot.api.setMyCommands([{ command: "trade", description: "Start a Private Swap" }, { command: "portfolio", description: "Open your Private Portfolio" }, { command: "wallet", description: "Wallet setup and settings" }, { command: "cancel", description: "Cancel the current swap" }]);
await bot.start({ allowed_updates: ["message", "callback_query"] });
