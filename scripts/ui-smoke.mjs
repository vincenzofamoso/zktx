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
  check((await page.locator("#action-title").textContent())?.includes("private note"), `${name}: private-send workspace initializes`);

  await page.locator('[data-tab="swap"]').click();
  check(await page.locator("#swap-fields").isVisible(), `${name}: swap fields appear`);
  check(await page.locator("#swap-setup").isVisible(), `${name}: swap setup appears before execution fields`);
  check((await page.locator("#action-title").textContent()) === "Swap without exposing your wallet", `${name}: swap copy updates`);
  await page.locator("#withdraw-action").evaluate((button) => button.click());
  check(await page.locator("#withdrawal-planner").isVisible(), `${name}: portfolio withdrawal flow appears`);
  await page.locator('[data-tab="send"]').click();
  check((await page.locator("#action-title").textContent()) === "Send a private note", `${name}: send copy updates`);

  await page.locator("#connect").click();
  check((await page.locator("#form-result").textContent())?.includes("Install an EVM wallet"), `${name}: missing-wallet state is safe`);

  await page.locator("#fund-action").click();
  await page.locator("#token").fill("0xC026Ab5fFE8F5AF0C62f9D7c8567af6e967A1e18");
  await page.locator("#token").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector("#token-meta")?.textContent.includes("SI"));
  await page.locator("#amount").fill("5");
  check((await page.locator("#amount-units").textContent())?.includes("5000000000000000000 base units"), `${name}: human SI amount converts to 18-decimal base units`);
  await page.locator("#note-password").fill("headless-test-password");
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
