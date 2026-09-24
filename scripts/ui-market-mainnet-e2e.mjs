import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const base = process.env.ZKTX_URL || "https://zktx.tech";
const rpcUrl = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const walletFile = process.env.ZKTX_E2E_WALLETS || "/home/ops/.zktx-secrets/mainnet-e2e-wallets.json";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const amount = process.env.ZKTX_E2E_AMOUNT || "0.000001";
const minimumOut = process.env.ZKTX_E2E_MINIMUM || "0.002";
const password = "mainnet-browser-market-e2e-password";
const stored = JSON.parse(await fs.readFile(walletFile, "utf8"));
const selected = stored.wallets.find((wallet) => wallet.role === "alice");
if (!selected) throw new Error("The Alice E2E wallet is missing");
const account = privateKeyToAccount(selected.private_key);
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const sent = [];

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
await page.exposeFunction("zktxTestRpc", async ({ method, params = [] }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
  if (method === "eth_chainId") return "0x1237";
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
  if (method === "eth_sendTransaction") {
    const tx = params[0];
    const hash = await walletClient.sendTransaction({ account, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined });
    sent.push(hash);
    return hash;
  }
  return publicClient.request({ method, params });
});
await page.addInitScript(() => {
  window.ethereum = { request: (payload) => window.zktxTestRpc(payload), on: () => {}, removeListener: () => {} };
});

const txHash = (href) => href?.split("/tx/")[1];
try {
  const response = await page.goto(`${base}/?market-e2e=${Date.now()}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error("Homepage failed to load");
  await page.locator("#connect").click();
  await page.waitForFunction(() => document.querySelector("#form-result")?.textContent.includes("Experimental live shielding"));

  await page.locator("#token").fill(weth);
  await page.locator("#token").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#token-meta")?.classList.contains("loaded"));
  await page.locator("#amount").fill(amount);
  await page.locator("#note-password").fill(password);
  await page.locator("#veil-form").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("#form-result")?.textContent.includes("Shielded deposit confirmed"), null, { timeout: 600_000 });
  const depositHash = txHash(await page.locator("#form-result a").getAttribute("href"));
  console.log(`E2E shielded ${amount} WETH: ${depositHash}`);

  await page.locator('.tabs button[data-tab="swap"]').click();
  await page.locator('.quote-assets button[data-quote="weth"]').click();
  await page.locator("#receive-token").fill(usdg);
  await page.locator("#receive-token").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#receive-token-meta")?.classList.contains("loaded"));
  await page.locator("#amount").fill(amount);
  await page.locator("#price-deviation").fill("5");
  await page.waitForFunction(() => Boolean(document.querySelector("#receive-amount")?.value));
  await page.locator("#veil-form").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("#activity-state")?.textContent === "Ready to claim", null, { timeout: 600_000 });
  const executionLinks = await page.locator("#activity-steps a").evaluateAll((links) => links.map((link) => link.href));
  console.log(`E2E market execution ready with ${executionLinks.length} linked transactions`);

  await page.locator("#activity-action").click();
  await page.waitForFunction(() => document.querySelector("#activity-state")?.textContent === "Claimed", null, { timeout: 600_000 });
  const settlementHash = txHash(await page.locator("#form-result a").getAttribute("href"));

  const uniqueLinks = [...new Set(executionLinks.map(txHash).filter(Boolean))];
  const receipts = {};
  for (const hash of [...new Set([...sent, ...uniqueLinks, settlementHash].filter(Boolean))]) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    receipts[hash] = { status: receipt.status, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), to: receipt.to };
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    account: account.address,
    amountIn: amount,
    minimumOut,
    approvalHash: sent[0],
    depositHash,
    openingHash: uniqueLinks[0],
    sliceHashes: uniqueLinks.slice(1),
    settlementHash,
    receipts,
  };
  await fs.writeFile("data/ui-market-mainnet-e2e.json", `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
