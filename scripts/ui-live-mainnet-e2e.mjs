import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const base = process.env.ZKTX_URL || "https://zktx.tech";
const rpcUrl = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const walletFile = process.env.ZKTX_E2E_WALLETS || "/home/ops/.zktx-secrets/mainnet-e2e-wallets.json";
const token = process.env.ZKTX_TOKEN_A || "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const amount = process.env.ZKTX_E2E_AMOUNT || "0.000001";
const stored = JSON.parse(await fs.readFile(walletFile, "utf8"));
const role = process.env.ZKTX_E2E_ROLE || "alice";
const selected = stored.wallets.find((wallet) => wallet.role === role);
if (!selected) throw new Error(`${role} test wallet is missing`);
const account = privateKeyToAccount(selected.private_key);
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("crash", () => errors.push("page crashed"));
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.exposeFunction("zktxTestRpc", async ({ method, params = [] }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
  if (method === "eth_chainId") return "0x1237";
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
  if (method === "eth_sendTransaction") {
    const tx = params[0];
    return walletClient.sendTransaction({ account, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined });
  }
  return publicClient.request({ method, params });
});
await page.addInitScript(() => {
  window.ethereum = { request: (payload) => window.zktxTestRpc(payload), on: () => {}, removeListener: () => {} };
});

try {
  const response = await page.goto(`${base}/?live-e2e=${Date.now()}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error("Homepage failed to load");
  await page.locator("#connect").click();
  await page.waitForFunction(() => document.querySelector("#form-result")?.textContent.includes("Experimental live shielding"));
  console.log("LIVE-UI wallet connected");
  await page.locator("#token").fill(token);
  await page.locator("#token").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#token-meta")?.classList.contains("loaded"));
  console.log("LIVE-UI token metadata loaded");
  await page.locator("#amount").fill(amount);
  await page.locator("#note-password").fill("mainnet-browser-e2e-password");
  await page.locator("#veil-form").evaluate((form) => form.requestSubmit());
  console.log("LIVE-UI proof and transaction flow started");
  await page.waitForFunction(() => document.querySelector("#form-result")?.textContent.includes("Shielded deposit confirmed"), null, { timeout: 600_000 });
  const result = await page.locator("#form-result").textContent();
  const href = await page.locator("#form-result a").getAttribute("href");
  if (!href?.includes("/tx/0x")) throw new Error("Confirmed UI did not expose a transaction link");
  if (!(await page.locator("#local-notes").textContent()).startsWith("1 spendable encrypted note")) throw new Error("Confirmed note was not encrypted locally");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, account: account.address, result, transaction: href.split("/tx/")[1] }, null, 2));
} catch (error) {
  console.error("LIVE-UI result:", await page.locator("#form-result").textContent().catch(() => "page unavailable"));
  console.error("LIVE-UI browser errors:", errors.join(" | "));
  throw error;
} finally {
  await browser.close();
}
