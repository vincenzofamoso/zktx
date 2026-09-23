import { Bot, InlineKeyboard } from "grammy";
import express from "express";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress, verifyMessage } from "viem";
import { parseEncryptedWalletEnvelope, verifyTelegramInitData } from "./security.js";

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
const signerButton = (label, query) => new InlineKeyboard().webApp(label, `${signerUrl}?${query}`);

function homeKeyboard(userId) {
  const keyboard = new InlineKeyboard().text("Shield", "flow:shield").text("Private send", "flow:send").row().text("Shielded market trade", "flow:market").text("Withdraw", "flow:withdraw").row().text("How it works", "how").text("Fees + burn", "fees").row();
  if (store.vaults[String(userId)]) keyboard.webApp("Wallet", `${signerUrl}?action=wallet`).text("Balance", "balance");
  else keyboard.webApp("Import wallet", `${signerUrl}?action=import`);
  return keyboard;
}

function startDraft(ctx, type) {
  if (!ctx.chat || !ctx.from) return null;
  if (type === "send" || type === "withdraw") return ctx.reply("Private send and withdrawal are temporarily gated while their trusted-device proof executors are completed. Shielding and shielded market trades are live in this bot.");
  const vault = vaultFor(ctx);
  if (!vault) return ctx.reply("Import a wallet once before creating ZKTX actions.", { reply_markup: signerButton("Import wallet", "action=import") });
  const firstStep = type === "send" || type === "withdraw" ? "recipient" : "token";
  store.drafts[String(ctx.chat.id)] = { id: randomBytes(8).toString("hex"), type, step: firstStep, userId: ctx.from.id, chatId: ctx.chat.id, wallet: vault.address, createdAt: new Date().toISOString() };
  const prompt = firstStep === "recipient"
    ? "Send the destination Robinhood Chain wallet address."
    : type === "market"
      ? "Send the contract address of the Robinhood Chain token you want to spend."
      : "Send the Robinhood Chain token contract address.";
  return save().then(() => ctx.reply(prompt));
}

function jobMessage(job) {
  const lines = [`Action: ${job.type}`, `Wallet: ${job.wallet}`, ...(job.token ? [`Pay token: ${job.token}`] : []), ...(job.receiveToken ? [`Receive token: ${job.receiveToken}`] : []), ...(job.amount ? [`Amount: ${job.amount}`] : []), ...(job.receiveAmount ? [`Minimum net received: ${job.receiveAmount}`] : []), ...(job.deadlineSeconds ? [`Execution deadline: ${job.deadlineSeconds} seconds`] : []), ...(job.recipient ? [`Destination: ${job.recipient}`] : [])];
  return `ZKTX Telegram authorization\nJob: ${job.id}\n${lines.join("\n")}\nExpires: ${job.expiresAt}`;
}

async function protocolStatus() {
  try {
    const response = await fetch(`${protocolUrl}/api/status`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { return null; }
}

async function verifiedVaultReceipt(transactionHash) {
  const [receiptResponse, readiness] = await Promise.all([
    fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [transactionHash] }), signal: AbortSignal.timeout(10_000) }),
    protocolStatus(),
  ]);
  const receipt = (await receiptResponse.json()).result;
  if (!receipt || BigInt(receipt.status || 0) !== 1n) throw new Error("Transaction is not confirmed successfully");
  if (!readiness?.vaultAddress || receipt.to?.toLowerCase() !== readiness.vaultAddress.toLowerCase()) throw new Error("Transaction did not execute against the active ZKTX vault");
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
  return `${protocolUrl}/?${query}`;
}

async function finalizeDraft(ctx, draft) {
  const job = { ...draft, status: "awaiting_signature", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  delete job.step;
  store.jobs.push(job); delete store.drafts[String(draft.chatId)]; await save();
  const marketCopy = job.type === "market" ? "\nExecution uses compatible existing RH liquidity in 3–7 variable slices. During the capped pre-token pilot, 1% accumulates as WETH for later ZKTX buyback-and-burn and 0.5% supports execution." : "";
  await ctx.reply(["<b>Review ZKTX action</b>", "", `Type: <b>${escape(job.type === "market" ? "shielded market trade" : job.type)}</b>`, job.token ? `Token: <code>${job.token}</code>` : "", job.amount ? `Amount: <code>${job.amount}</code>` : "", job.receiveToken ? `Receive token: <code>${job.receiveToken}</code>` : "", job.receiveAmount ? `Minimum net received: <code>${job.receiveAmount}</code>` : "", job.recipient ? `Destination: <code>${job.recipient}</code>` : "", marketCopy, "One secure confirmation creates the proof, signs, and executes from your trusted device."].filter(Boolean).join("\n"), { parse_mode: "HTML", reply_markup: signerButton("🔐 Sign and execute", `action=authorize&job=${encodeURIComponent(job.id)}`) });
}

const bot = new Bot(token);
bot.use(async (ctx, next) => { if (!permitted(ctx)) return ctx.reply("This bot is not enabled in this chat."); await next(); });
bot.command("start", async (ctx) => ctx.from && ctx.reply("<b>ZKTX</b>\n\nShield Robinhood Chain tokens, send private notes, or trade through compatible existing RH liquidity without exposing your wallet as the public trader. Proceeds settle back into shielded notes.\n\nNo ZEC, bridge, wrapped privacy asset, or new wallet required.", { parse_mode: "HTML", reply_markup: homeKeyboard(ctx.from.id) }));
bot.command("wallet", async (ctx) => ctx.from && ctx.reply(vaultFor(ctx) ? `<b>Trusted-device wallet</b>\n<code>${vaultFor(ctx).address}</code>` : "No wallet imported.", { parse_mode: "HTML", reply_markup: vaultFor(ctx) ? signerButton("Open wallet", "action=wallet") : signerButton("Import wallet", "action=import") }));
bot.command("shield", (ctx) => startDraft(ctx, "shield"));
bot.command("send", (ctx) => startDraft(ctx, "send"));
bot.command("trade", (ctx) => startDraft(ctx, "market"));
bot.command("swap", (ctx) => startDraft(ctx, "market"));
bot.command("withdraw", (ctx) => startDraft(ctx, "withdraw"));
bot.command("balance", async (ctx) => ctx.reply("Shielded balances are derived from encrypted notes on your trusted device. Open the wallet to view them.", { reply_markup: signerButton("Open private balance", "action=wallet") }));
bot.command("status", async (ctx) => { const jobs = store.jobs.filter((job) => job.userId === ctx.from?.id).slice(-5).reverse(), status = await protocolStatus(); const readiness = !status ? "Protocol API unavailable" : [`Vault: ${status.contractsReady ? "ready" : "not ready"}`, `Relayer: ${status.relayerReady ? "ready" : "offline"}`, `Execution keeper: ${status.marketKeeperReady ? "ready" : "offline"}`].join(" · "); await ctx.reply(`<b>ZKTX status</b>\n${escape(readiness)}\n\n${jobs.length ? jobs.map((job) => `${escape(job.type)}: ${escape(job.status)}`).join("\n") : "No recent actions."}`, { parse_mode: "HTML" }); });
bot.command("how", async (ctx) => ctx.reply("<b>How ZKTX works</b>\n\n1. Shield the RH token you already own.\n2. Ownership becomes an encrypted private note.\n3. For a market trade, the ZKTX vault uses a compatible approved RH liquidity route in 3–7 slices.\n4. The venue sees the vault—not your originating wallet.\n5. Your actual proceeds return as shielded notes.\n\nAMM swaps remain public; wallet ownership and private-note transfers are shielded.", { parse_mode: "HTML" }));
bot.command("fees", async (ctx) => ctx.reply("<b>Fees and flywheel</b>\n\nShielded market trades charge 1.5% total:\n• 1% is reserved for ZKTX buyback-and-burn\n• 0.5% supports execution\n\nDuring the capped pre-token pilot, the 1% remains accounted as WETH. Once the real ZKTX token is activated, accumulated and future allocations can buy and burn ZKTX.", { parse_mode: "HTML" }));
bot.command("cancel", async (ctx) => { if (ctx.chat) delete store.drafts[String(ctx.chat.id)]; await save(); await ctx.reply("Current action cancelled."); });
bot.callbackQuery(/^flow:(shield|send|market|withdraw)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startDraft(ctx, ctx.match[1]); });
bot.callbackQuery("how", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Shield RH tokens into private notes. ZKTX can then execute through a compatible RH market route, split across 3–7 blocks, and return the proceeds to you as shielded notes. The public sees vault execution—not your wallet as the trader."); });
bot.callbackQuery("fees", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Market fee: 1.5%. During the capped pre-token pilot, 1% accumulates as WETH for later ZKTX buyback-and-burn; 0.5% supports execution."); });
bot.callbackQuery(/^deadline:(120|300|900)$/, async (ctx) => { await ctx.answerCallbackQuery(); const draft = draftFor(ctx); if (!draft || draft.type !== "market" || draft.step !== "deadline") return ctx.reply("That market-trade draft is no longer active."); draft.deadlineSeconds = Number(ctx.match[1]); await finalizeDraft(ctx, draft); });
bot.callbackQuery("balance", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Shielded balances are decrypted only on your trusted device.", { reply_markup: signerButton("Open private balance", "action=wallet") }); });
bot.on("message:text", async (ctx) => {
  const draft = draftFor(ctx); if (!draft || ctx.message.text.startsWith("/")) return;
  const text = ctx.message.text.trim();
  try {
    if (draft.step === "recipient") { if (!isAddress(text)) throw new Error("Send a valid 0x destination address."); draft.recipient = getAddress(text); draft.step = draft.type === "send" ? "token" : "token"; await save(); return ctx.reply("Send the token contract address."); }
    if (draft.step === "token") { if (!addressPattern.test(text)) throw new Error("Send a valid token contract address."); draft.token = getAddress(text); draft.step = "amount"; await save(); return ctx.reply("Send the amount as a normal token amount, for example: 5 or 0.25"); }
    if (draft.step === "amount") { if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error("Amount must be a positive token amount."); draft.amount = text; if (draft.type === "market") { draft.step = "receiveToken"; await save(); return ctx.reply("Send the contract address of the token you want to receive."); } return finalizeDraft(ctx, draft); }
    if (draft.step === "receiveToken") { if (!addressPattern.test(text)) throw new Error("Send a valid receive-token contract."); draft.receiveToken = getAddress(text); draft.step = "receiveAmount"; await save(); return ctx.reply("Send the minimum net amount you are willing to receive as a normal token amount. The 1.5% ZKTX fee must fit inside this limit."); }
    if (draft.step === "receiveAmount") { if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error("Minimum received must be positive."); draft.receiveAmount = text; draft.step = "deadline"; await save(); return ctx.reply("Choose how long the order may execute.", { reply_markup: new InlineKeyboard().text("2 minutes", "deadline:120").text("5 minutes", "deadline:300").text("15 minutes", "deadline:900") }); }
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
    const keyboard = new InlineKeyboard().webApp("Continue in ZKTX", executionUrl(job));
    const note = job.status === "authorized_ready" ? "Continue to generate the proof and execute." : "Authorization is saved, but execution is currently unavailable because the relayer or execution keeper is offline.";
    await bot.api.sendMessage(job.chatId, `✅ ${job.type === "market" ? "shielded market trade" : job.type} authorized by ${job.wallet.slice(0, 8)}…${job.wallet.slice(-6)}. ${note}`, { reply_markup: keyboard });
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Authorization failed" }); }
});
app.post("/api/v1/jobs/:id/complete", async (req, res) => {
  try {
    const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature");
    if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error("Execution job expired");
    const transactionHash = String(req.body?.transactionHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error("Invalid transaction receipt");
    await verifiedVaultReceipt(transactionHash);
    const orderId = req.body?.orderId == null ? null : String(req.body.orderId);
    if (orderId && !/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new Error("Invalid market order id");
    job.status = "executed"; job.executedAt = new Date().toISOString(); job.transactionHash = transactionHash;
    if (orderId) job.orderId = orderId;
    await save();
    const explorer = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
    await bot.api.sendMessage(job.chatId, `✅ <b>${job.type === "market" ? "Shielded market trade submitted" : "Shield deposit confirmed"}</b>\n\nTransaction: <a href="${explorer}">${transactionHash.slice(0, 12)}…${transactionHash.slice(-8)}</a>${orderId ? `\nOrder: <code>${orderId}</code>` : ""}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Could not record execution" }); }
});
app.listen(port, "127.0.0.1", () => console.log(`ZKTX Telegram API listening on ${port}`));
bot.catch(({ error }) => console.error("ZKTX bot", error?.message || error));
await bot.api.setMyCommands([{ command: "trade", description: "Prepare a shielded RH market trade" }, { command: "shield", description: "Shield an RH token" }, { command: "send", description: "Prepare a private transfer" }, { command: "withdraw", description: "Withdraw to a public wallet" }, { command: "balance", description: "Open private balance" }, { command: "wallet", description: "Manage trusted-device wallet" }, { command: "how", description: "How ZKTX protects a trade" }, { command: "fees", description: "Fees and ZKTX buyback/burn" }, { command: "status", description: "Protocol readiness and recent actions" }, { command: "cancel", description: "Cancel current action" }]);
await bot.start({ allowed_updates: ["message", "callback_query"] });
