import { chromium } from "playwright-core";

const base = process.env.ZKTX_URL || "https://zktx.tech";
const executablePath = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const failures = [];
const results = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  else results.push(message);
}

async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => runtimeErrors.push(`request: ${request.url()} (${request.failure()?.errorText})`));

  const response = await page.goto(`${base}/`, { waitUntil: "networkidle" });
  check(response?.ok(), `${name}: homepage returns success`);
  check(await page.locator(".brand img").isVisible(), `${name}: brand is visible`);
  check(await page.locator(".dapp-preview-frame img").isVisible(), `${name}: dapp preview is visible`);
  check((await page.locator('.dapp-preview a[href="./app.html"]').count()) >= 1, `${name}: homepage links to the dapp`);

  const appResponse = await page.goto(`${base}/app.html`, { waitUntil: "networkidle" });
  check(appResponse?.ok(), `${name}: dapp returns success`);
  check(await page.locator(".usp-grid").isHidden(), `${name}: dapp hides homepage marketing cards`);
  check(await page.locator(".workspace-copy").isHidden(), `${name}: dapp only shows the product workspace`);
  check(await page.locator(".terminal").isVisible(), `${name}: dapp workspace is visible`);
  check(await page.locator('.topbar nav a[href="./"]').isVisible(), `${name}: dapp retains the main navigation`);
  check((await page.locator("#action-title").textContent()) === "Swap without exposing your wallet", `${name}: private swap is the default first tab`);
  check(await page.locator("#market-settlement").isHidden(), `${name}: manual settlement panel does not interrupt the swap flow`);
  check(await page.locator("#swap-private-assets").isVisible(), `${name}: swap can trade directly from the Private Portfolio`);
  check((await page.locator("#swap-prerequisite").textContent()).includes("without returning it to your public wallet"), `${name}: portfolio-funded swap explains direct private trading`);
  await page.locator('[data-direction="sell"]').click();
  await page.locator('[data-source="wallet"]').click();
  check(await page.locator("#wallet-assets").isVisible(), `${name}: sell flow exposes connected-wallet token balances`);
  check(await page.locator("#amount-half").isVisible() && await page.locator("#amount-max").isVisible(), `${name}: wallet-funded sells offer Half and Max`);
  check(await page.locator("#portfolio-panel").isHidden(), `${name}: portfolio stays out of transaction forms`);
  const tabRows = await page.locator(".tabs button").evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size);
  check(tabRows === 1 && await page.locator(".tabs button").count() === 2, `${name}: Swap and Portfolio remain the only primary tabs`);
  await page.locator('[data-tab="portfolio"]').click();
  check(await page.locator("#portfolio-panel").isVisible(), `${name}: portfolio has its own tab`);
  check(await page.locator("#portfolio-actions button").count() === 5, `${name}: portfolio exposes balance, transfer and swap actions`);
  check(await page.locator("#action-submit").isHidden(), `${name}: portfolio tab hides transaction actions`);
  check(await page.locator("#bulk-unshield-recipient").isVisible(), `${name}: portfolio exposes a bulk unshield destination`);
  check((await page.locator("#bulk-unshield").textContent()) === "Unshield all", `${name}: portfolio exposes bulk unshield`);
  check(await page.evaluate(() => { const row = document.createElement("div"); row.className = "portfolio-item"; document.body.append(row); const readable = Number.parseFloat(getComputedStyle(row).fontSize) >= 14; row.remove(); return readable; }), `${name}: private balances are readable`);

  await page.locator('[data-tab="swap"]').click();
  check(await page.locator("#swap-fields").isVisible(), `${name}: swap fields appear`);
  check(await page.locator("#swap-setup").isVisible(), `${name}: swap setup appears before execution fields`);
  check(await page.locator("#workflow-guide").isHidden(), `${name}: swap does not expose a separate shielding step`);
  check((await page.locator("#swap-prerequisite").textContent()).includes("shields the selected amount automatically"), `${name}: wallet-funded swap explains automatic shielding`);
  check((await page.locator("#action-title").textContent()) === "Swap without exposing your wallet", `${name}: swap copy updates`);
  check((await page.locator("#action-submit").textContent()) === "Submit Private Swap", `${name}: swap action is bound to the form submit button`);
  check((await page.locator("#settle-market").textContent()) === "Add completed swap to private portfolio", `${name}: settlement action remains independently bound`);
  await page.locator("#withdraw-action").evaluate((button) => button.click());
  check(await page.locator("#withdrawal-planner").isVisible(), `${name}: portfolio withdrawal flow appears`);
  await page.locator('[data-tab="portfolio"]').click();
  await page.locator("#portfolio-send").click();
  check((await page.locator("#action-title").textContent()) === "Send a private note", `${name}: send copy updates`);
  check(await page.locator("#swap-private-assets").isVisible(), `${name}: Private Send chooses an existing private balance`);
  check(await page.locator("#wallet-assets").isVisible(), `${name}: Private Send shows connected-wallet balances`);
  check(await page.locator(".send-source button").count() === 2, `${name}: Private Send offers public and private funding sources`);
  check(await page.locator("#workflow-guide").isHidden(), `${name}: Private Send does not require a separate manual shielding step`);
  check(await page.locator("#private-recipient").isVisible(), `${name}: private send asks for the recipient private address`);
  await page.locator("#portfolio-receive").click();
  check(await page.locator("#receive-fields").isVisible(), `${name}: Private Receive lives inside Portfolio`);
  check((await page.locator(".private-receive-tools").textContent()).includes("Incoming private transfers appear"), `${name}: private receive explains automatic delivery`);
  check(await page.evaluate(() => typeof window.ZKTXWallet?.syncPrivateInbox === "function"), `${name}: private receive inbox is wired to the browser wallet client`);

  await page.locator("#connect").click();
  check((await page.locator("#form-result").textContent())?.includes("Install an EVM wallet"), `${name}: missing-wallet state is safe`);

  await page.locator('[data-tab="portfolio"]').click();
  await page.locator("#portfolio-add").click();
  check(await page.locator("#wallet-assets").isVisible(), `${name}: add private balance shows connected-wallet assets`);
  check(await page.locator("#amount-half").isVisible() && await page.locator("#amount-max").isVisible(), `${name}: shield amount offers Half and Max controls`);
  check(Number.parseFloat(await page.locator("#token-label").evaluate((element) => getComputedStyle(element).fontSize)) >= 12, `${name}: dapp helper text remains readable`);
  await page.locator("#token").fill("0xC026Ab5fFE8F5AF0C62f9D7c8567af6e967A1e18");
  await page.locator("#token").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#token-meta")?.textContent.includes("SI"));
  await page.locator("#amount").fill("5");
  check((await page.locator("#amount-units").textContent())?.includes("5000000000000000000 base units"), `${name}: human SI amount converts to 18-decimal base units`);
  await page.locator("#veil-form").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("#form-result")?.textContent.includes("Connect your wallet"));
  check((await page.locator("#local-notes").textContent())?.startsWith("0 spendable encrypted notes"), `${name}: no note is stored before an onchain confirmation`);

  const caseResponse = await page.goto(`${base}/case-study.html`, { waitUntil: "networkidle" });
  check(caseResponse?.ok(), `${name}: case study returns success`);
  check(await page.locator(".tx").count() >= 9, `${name}: funded shielded swap transactions render`);
  check(await page.locator("#contracts article").count() === 7, `${name}: current market contracts render`);
  check(await page.locator("#checks .check").count() >= 3, `${name}: final checks render`);
  check(
    await page.locator('.tx a[href^="https://robinhoodchain.blockscout.com/tx/"]').count() === await page.locator(".tx").count(),
    `${name}: all transaction links target Blockscout`,
  );

  const docsResponse = await page.goto(`${base}/docs.html`, { waitUntil: "networkidle" });
  check(docsResponse?.ok(), `${name}: docs return success`);
  check((await page.locator("body").innerText()).includes("Zcash solved the ownership problem"), `${name}: docs explain the design choice`);
  check(await page.locator('a[href="./case-study.html"]').count() > 0, `${name}: docs link to evidence`);

  const telegramResponse = await page.goto(`${base}/telegram/?action=import`, { waitUntil: "networkidle" });
  check(telegramResponse?.ok(), `${name}: Telegram wallet setup returns success`);
  check(await page.locator("#create-wallet").isVisible(), `${name}: Telegram setup leads with wallet creation`);
  check(await page.locator("#import-existing #private-key").count() === 1, `${name}: Telegram wallet import only asks for a private key`);
  check(await page.locator("#passphrase").count() === 0, `${name}: Telegram setup does not require a seed or chosen passphrase`);
  check((await page.locator("#backup").textContent()).includes("Copy your private key"), `${name}: generated wallet reveals a copyable private key backup`);
  check((await page.locator("#backup").textContent()).includes("YOUR FUNDING ADDRESS"), `${name}: generated wallet shows its funding address immediately`);
  check((await page.locator("#wallet").textContent()).includes("small RH ETH balance for gas"), `${name}: wallet screen explains funding and gas`);
  check(runtimeErrors.length === 0, `${name}: no console, page, or failed-request errors${runtimeErrors.length ? ` (${runtimeErrors.join(" | ")})` : ""}`);
  await context.close();
}

try {
  await runViewport("desktop", { width: 1440, height: 1000 });
  await runViewport("mobile", { width: 390, height: 844 });
} finally {
  await browser.close();
}

for (const result of results) console.log(`PASS ${result}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`SUMMARY ${results.length} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
