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
const port = Number(process.env.PORT || 3480);
const allowedChats = new Set((process.env.ALLOWED_CHAT_IDS || "").split(",").map(Number).filter(Number.isSafeInteger));
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
  const keyboard = new InlineKeyboard().text("Shield", "flow:shield").text("Private send", "flow:send").row().text("Private swap", "flow:swap").text("Withdraw", "flow:withdraw").row();
  if (store.vaults[String(userId)]) keyboard.webApp("Wallet", `${signerUrl}?action=wallet`).text("Balance", "balance");
  else keyboard.webApp("Import wallet", `${signerUrl}?action=import`);
  return keyboard;
}

function startDraft(ctx, type) {
  if (!ctx.chat || !ctx.from) return null;
  const vault = vaultFor(ctx);
  if (!vault) return ctx.reply("Import a wallet once before creating ZKTX actions.", { reply_markup: signerButton("Import wallet", "action=import") });
  const firstStep = type === "send" || type === "withdraw" ? "recipient" : "token";
  store.drafts[String(ctx.chat.id)] = { id: randomBytes(8).toString("hex"), type, step: firstStep, userId: ctx.from.id, chatId: ctx.chat.id, wallet: vault.address, createdAt: new Date().toISOString() };
  return save().then(() => ctx.reply(firstStep === "recipient" ? "Send the destination Robinhood Chain wallet address." : "Send the Robinhood Chain token contract address."));
}

function jobMessage(job) {
  const lines = [`Action: ${job.type}`, `Wallet: ${job.wallet}`, ...(job.token ? [`Token: ${job.token}`] : []), ...(job.receiveToken ? [`Receive token: ${job.receiveToken}`] : []), ...(job.amount ? [`Amount: ${job.amount} base units`] : []), ...(job.receiveAmount ? [`Receive: ${job.receiveAmount} base units`] : []), ...(job.recipient ? [`Destination: ${job.recipient}`] : [])];
  return `ZKTX Telegram authorization\nJob: ${job.id}\n${lines.join("\n")}\nExpires: ${job.expiresAt}`;
}

async function finalizeDraft(ctx, draft) {
  const job = { ...draft, status: "awaiting_signature", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  delete job.step;
  store.jobs.push(job); delete store.drafts[String(draft.chatId)]; await save();
  await ctx.reply(["<b>Review ZKTX action</b>", "", `Type: <b>${escape(job.type)}</b>`, job.token ? `Token: <code>${job.token}</code>` : "", job.amount ? `Amount: <code>${job.amount}</code>` : "", job.receiveToken ? `Receive token: <code>${job.receiveToken}</code>` : "", job.receiveAmount ? `Receive amount: <code>${job.receiveAmount}</code>` : "", job.recipient ? `Destination: <code>${job.recipient}</code>` : "", "", "The signer will authorize this action on your trusted device. Mainnet execution remains gated until production proving keys and an audit are complete."].filter(Boolean).join("\n"), { parse_mode: "HTML", reply_markup: signerButton("Authorize on trusted device", `action=authorize&job=${encodeURIComponent(job.id)}`) });
}

const bot = new Bot(token);
bot.use(async (ctx, next) => { if (!permitted(ctx)) return ctx.reply("This bot is not enabled in this chat."); await next(); });
bot.command("start", async (ctx) => ctx.from && ctx.reply("<b>ZKTX</b>\n\nShield, privately transfer, swap, and withdraw standard Robinhood Chain tokens using text workflows. Wallet keys and private-note secrets are never available to the bot in plaintext.", { parse_mode: "HTML", reply_markup: homeKeyboard(ctx.from.id) }));
bot.command("wallet", async (ctx) => ctx.from && ctx.reply(vaultFor(ctx) ? `<b>Trusted-device wallet</b>\n<code>${vaultFor(ctx).address}</code>` : "No wallet imported.", { parse_mode: "HTML", reply_markup: vaultFor(ctx) ? signerButton("Open wallet", "action=wallet") : signerButton("Import wallet", "action=import") }));
bot.command("shield", (ctx) => startDraft(ctx, "shield"));
bot.command("send", (ctx) => startDraft(ctx, "send"));
bot.command("swap", (ctx) => startDraft(ctx, "swap"));
bot.command("withdraw", (ctx) => startDraft(ctx, "withdraw"));
bot.command("balance", async (ctx) => ctx.reply("Shielded balances are derived from encrypted notes on your trusted device. Open the wallet to view them.", { reply_markup: signerButton("Open private balance", "action=wallet") }));
bot.command("status", async (ctx) => { const jobs = store.jobs.filter((job) => job.userId === ctx.from?.id).slice(-5).reverse(); await ctx.reply(jobs.length ? jobs.map((job) => `${job.type}: ${job.status}`).join("\n") : "No ZKTX jobs yet."); });
bot.command("cancel", async (ctx) => { if (ctx.chat) delete store.drafts[String(ctx.chat.id)]; await save(); await ctx.reply("Current action cancelled."); });
bot.callbackQuery(/^flow:(shield|send|swap|withdraw)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startDraft(ctx, ctx.match[1]); });
bot.callbackQuery("balance", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Shielded balances are decrypted only on your trusted device.", { reply_markup: signerButton("Open private balance", "action=wallet") }); });
bot.on("message:text", async (ctx) => {
  const draft = draftFor(ctx); if (!draft || ctx.message.text.startsWith("/")) return;
  const text = ctx.message.text.trim();
  try {
    if (draft.step === "recipient") { if (!isAddress(text)) throw new Error("Send a valid 0x destination address."); draft.recipient = getAddress(text); draft.step = draft.type === "send" ? "token" : "token"; await save(); return ctx.reply("Send the token contract address."); }
    if (draft.step === "token") { if (!addressPattern.test(text)) throw new Error("Send a valid token contract address."); draft.token = getAddress(text); draft.step = "amount"; await save(); return ctx.reply("Send the amount in token base units as a positive integer."); }
    if (draft.step === "amount") { if (!/^\d+$/.test(text) || BigInt(text) <= 0n) throw new Error("Amount must be a positive base-unit integer."); draft.amount = text; if (draft.type === "swap") { draft.step = "receiveToken"; await save(); return ctx.reply("Send the token contract you want to receive."); } return finalizeDraft(ctx, draft); }
    if (draft.step === "receiveToken") { if (!addressPattern.test(text)) throw new Error("Send a valid receive-token contract."); draft.receiveToken = getAddress(text); draft.step = "receiveAmount"; await save(); return ctx.reply("Send the minimum receive amount in base units."); }
    if (draft.step === "receiveAmount") { if (!/^\d+$/.test(text) || BigInt(text) <= 0n) throw new Error("Receive amount must be positive."); draft.receiveAmount = text; return finalizeDraft(ctx, draft); }
  } catch (error) { await ctx.reply(error.message || "Invalid input"); }
});

const app = express();
app.disable("x-powered-by"); app.use(express.json({ limit: "32kb" }));
function webUser(req) { const initData = req.get("x-telegram-init-data"); if (!initData) throw new Error("Telegram authorization required"); return verifyTelegramInitData(initData, token); }
app.get("/health", (_req, res) => res.json({ ok: true, protocol: "gated" }));
app.get("/api/v1/vault", (req, res) => { try { const user = webUser(req), vault = store.vaults[String(user.id)]; return vault ? res.json({ vault }) : res.status(404).json({ error: "Wallet not found" }); } catch { return res.status(401).json({ error: "Telegram authorization required" }); } });
app.put("/api/v1/vault", async (req, res) => { try { const user = webUser(req), vault = parseEncryptedWalletEnvelope(req.body); store.vaults[String(user.id)] = vault; await save(); return res.json({ address: vault.address }); } catch (error) { return res.status(400).json({ error: error.message || "Invalid encrypted wallet" }); } });
app.get("/api/v1/jobs/:id", (req, res) => { try { const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature"); if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error(); return res.json({ job, message: jobMessage(job), protocolUrl }); } catch { return res.status(404).json({ error: "Authorization job unavailable" }); } });
app.post("/api/v1/jobs/:id/authorize", async (req, res) => {
  try {
    const user = webUser(req), job = store.jobs.find((entry) => entry.id === req.params.id && entry.userId === user.id && entry.status === "awaiting_signature");
    if (!job || Date.parse(job.expiresAt) < Date.now()) throw new Error("Authorization expired");
    const signature = String(req.body?.signature || ""), valid = await verifyMessage({ address: job.wallet, message: jobMessage(job), signature });
    if (!valid) throw new Error("Signature did not match imported wallet");
    job.status = "authorized_gated"; job.authorizedAt = new Date().toISOString(); job.signature = signature; await save();
    await bot.api.sendMessage(job.chatId, `✅ ${job.type} authorized by ${job.wallet.slice(0, 8)}…${job.wallet.slice(-6)}. No transaction was broadcast: public execution remains gated pending production proving keys and audit.`);
    return res.json({ ok: true, status: job.status });
  } catch (error) { return res.status(400).json({ error: error.message || "Authorization failed" }); }
});
app.listen(port, "127.0.0.1", () => console.log(`ZKTX Telegram API listening on ${port}`));
bot.catch(({ error }) => console.error("ZKTX bot", error?.message || error));
await bot.api.setMyCommands([{ command: "shield", description: "Shield an RH token" }, { command: "send", description: "Prepare a private transfer" }, { command: "swap", description: "Prepare a private RFQ swap" }, { command: "withdraw", description: "Withdraw to a public wallet" }, { command: "balance", description: "Open private balance" }, { command: "wallet", description: "Manage trusted-device wallet" }, { command: "status", description: "Recent ZKTX actions" }, { command: "cancel", description: "Cancel current action" }]);
await bot.start({ allowed_updates: ["message", "callback_query"] });
