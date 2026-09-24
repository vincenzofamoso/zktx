import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/state-store.js";
import { createIndexer } from "../src/indexer.js";
import { createRelayer } from "../src/relayer.js";
import { createMarketKeeper } from "../src/market-keeper.js";
import { vaultAbi } from "../src/vault-abi.js";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const port = Number(process.env.PORT || 3478);
const mode = process.env.PROTOCOL_MODE === "live" ? "live" : "preview";
const chainId = 4663;
const vaultAddress = process.env.ZKTX_VAULT_ADDRESS || null;
const rpcUrl = process.env.RH_RPC_URL || null;
const readRpcUrl = rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
const readClient = createPublicClient({ transport: http(readRpcUrl, { retryCount: 1 }) });
const tokenAbi = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);
const marketConfigAbi = parseAbi(["function marketAdapter() view returns (address)"]);
const routingAbi = parseAbi(["function routeKey(address,address) pure returns (bytes32)", "function routes(bytes32) view returns (address)", "function proposeRoute(address,address,address)", "function activateRoute(address,address)"]);
const vaultAdminAbi = parseAbi(["function supportedAssets(address) view returns (bool)", "function reserveCaps(address) view returns (uint256)", "function setAssetSupported(address,bool)", "function setReserveCap(address,uint256)"]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi(["function liquidity() view returns (uint128)"]);
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const AGGREGATOR_ADAPTER = "0x357A1B97EAbA27689D33455Ce768687B696e81ed";
const AGGREGATOR_QUOTE_URL = process.env.ZKTX_AGGREGATOR_QUOTE_URL || "http://127.0.0.1:3010/swap-quote";
const ZERO = "0x0000000000000000000000000000000000000000";
const v3Adapters = new Map([
  [100, "0xd8c8291b0b32202dCe58540e956F33018D459F59"],
  [500, "0x1249E94E2BfA0BB84Ba27c84e79306055b9562EA"],
  [3000, "0x3441067f5A3E4330B2662C693c3fb4781E8967D5"],
  [10000, "0x63da34029B8705b49a68dCc3442D7EC91E322B9D"],
]);
const tokenCache = new Map();
const store = new StateStore(process.env.ZKTX_STATE_FILE || path.join(root, "data", "state.json"));
await store.load();
let indexer = null;
let relayer = null;
let marketKeeper = null;
let routeOperator = null;
function credentialKey(role) {
  const filename = process.env.ZKTX_OPERATOR_WALLETS_FILE;
  if (!filename) return null;
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
  const record = parsed.wallets?.find((wallet) => wallet.role === role);
  if (!record || !/^0x[0-9a-fA-F]{64}$/.test(record.private_key || "")) {
    throw new Error(`Missing ${role} key in operator wallet credential`);
  }
  return record.private_key;
}
if (mode === "live" && vaultAddress && rpcUrl) {
  indexer = createIndexer({ rpcUrl, vaultAddress, store, startBlock: BigInt(process.env.ZKTX_START_BLOCK || 0) });
  await indexer.sync();
  setInterval(() => indexer.sync().catch((error) => console.error("indexer", error.message)), 12_000).unref();
  const relayerKey = process.env.ZKTX_RELAYER_PRIVATE_KEY || credentialKey("relayer");
  if (relayerKey) relayer = createRelayer({ rpcUrl, vaultAddress, privateKey: relayerKey, chainId });
  const keeperKey = process.env.ZKTX_KEEPER_PRIVATE_KEY || relayerKey;
  if (process.env.ZKTX_MARKET_KEEPER_ENABLED === "true" && keeperKey) {
    marketKeeper = createMarketKeeper({
      rpcUrl,
      privateKey: keeperKey,
      vaultAddress,
      chainId,
      buybackSlippageBps: Number(process.env.ZKTX_BUYBACK_SLIPPAGE_BPS || 500),
      aggregatorAdapter: AGGREGATOR_ADAPTER,
      aggregatorQuoteUrl: AGGREGATOR_QUOTE_URL,
    });
    setInterval(() => marketKeeper.tick().catch((error) => console.error("market keeper", error.message)), 1_000).unref();
  }
  const routeOwnerKey = credentialKey("deployer_owner");
  if (routeOwnerKey) {
    const account = privateKeyToAccount(routeOwnerKey);
    routeOperator = createWalletClient({ account, transport: http(rpcUrl) });
  }
}

async function activeRoute(router, tokenIn, tokenOut) {
  const key = await readClient.readContract({ address: router, abi: routingAbi, functionName: "routeKey", args: [tokenIn, tokenOut] });
  return readClient.readContract({ address: router, abi: routingAbi, functionName: "routes", args: [key] });
}

async function discoverV3Adapter(tokenIn, tokenOut) {
  let selected = null;
  for (const [fee, adapter] of v3Adapters) {
    const pool = await readClient.readContract({ address: V3_FACTORY, abi: factoryAbi, functionName: "getPool", args: [tokenIn, tokenOut, fee] });
    if (pool === ZERO) continue;
    const liquidity = await readClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" });
    if (liquidity > 0n && (!selected || liquidity > selected.liquidity)) selected = { adapter, fee, pool, liquidity };
  }
  return selected;
}

async function aggregatorHasLiquidity(tokenIn, tokenOut) {
  const decimals = Number(await readClient.readContract({ address: tokenIn, abi: tokenAbi, functionName: "decimals" }));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return false;
  const nominal = 10n ** BigInt(decimals);
  const probes = [...new Set([nominal, nominal / 1_000n, nominal / 1_000_000n, 1n].filter((value) => value > 0n))];
  for (const amount of probes) {
    try {
      const response = await fetch(AGGREGATOR_QUOTE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "price", sellToken: tokenIn, buyToken: tokenOut, sellAmount: String(amount), taker: AGGREGATOR_ADAPTER, slippageBps: 500 }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) continue;
      const quote = await response.json();
      if (quote.liquidityAvailable === true && BigInt(quote.buyAmount || 0) > 0n) return true;
    } catch {}
  }
  return false;
}

async function ensureAssetSupported(asset) {
  const supported = await readClient.readContract({ address: vaultAddress, abi: vaultAdminAbi, functionName: "supportedAssets", args: [asset] });
  if (supported) return;
  const supply = await readClient.readContract({ address: asset, abi: supplyAbi, functionName: "totalSupply" });
  if (supply <= 0n) throw new Error("Token supply could not be validated");
  const cap = supply / 1_000n || 1n;
  let hash = await routeOperator.writeContract({ address: vaultAddress, abi: vaultAdminAbi, functionName: "setReserveCap", args: [asset, cap] });
  await readClient.waitForTransactionReceipt({ hash });
  hash = await routeOperator.writeContract({ address: vaultAddress, abi: vaultAdminAbi, functionName: "setAssetSupported", args: [asset, true] });
  await readClient.waitForTransactionReceipt({ hash });
}

async function ensureRoute(tokenIn, tokenOut) {
  if (!routeOperator) throw new Error("Automatic route activation is unavailable");
  if (tokenIn.toLowerCase() !== WETH.toLowerCase() && tokenOut.toLowerCase() !== WETH.toLowerCase()) {
    throw new Error("Shielded Swap currently settles arbitrary tokens through WETH");
  }
  const router = await readClient.readContract({ address: vaultAddress, abi: marketConfigAbi, functionName: "marketAdapter" });
  let adapter = await activeRoute(router, tokenIn, tokenOut);
  if (adapter !== ZERO) return { router, adapter, approved: true, activated: false };
  const discovered = await discoverV3Adapter(tokenIn, tokenOut);
  const aggregatorAvailable = discovered ? false : await aggregatorHasLiquidity(tokenIn, tokenOut);
  if (!discovered && !aggregatorAvailable) throw new Error("No executable RH liquidity exists for this pair");
  await ensureAssetSupported(tokenIn);
  await ensureAssetSupported(tokenOut);
  const selectedAdapter = discovered?.adapter || AGGREGATOR_ADAPTER;
  let hash = await routeOperator.writeContract({ address: router, abi: routingAbi, functionName: "proposeRoute", args: [tokenIn, tokenOut, selectedAdapter] });
  await readClient.waitForTransactionReceipt({ hash });
  hash = await routeOperator.writeContract({ address: router, abi: routingAbi, functionName: "activateRoute", args: [tokenIn, tokenOut] });
  await readClient.waitForTransactionReceipt({ hash });
  adapter = await activeRoute(router, tokenIn, tokenOut);
  if (adapter.toLowerCase() !== selectedAdapter.toLowerCase()) throw new Error("Route activation could not be confirmed");
  return { router, adapter, approved: true, activated: true, venue: discovered ? "uniswap-v3" : "rh-aggregator", fee: discovered?.fee, pool: discovered?.pool };
}

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

const walletRpcMethods = new Set([
  "eth_blockNumber", "eth_call", "eth_chainId", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice",
  "eth_getBalance", "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs",
  "eth_getStorageAt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "net_version", "web3_clientVersion",
]);
const rpcWindows = new Map();
app.post("/api/rpc", async (req, res) => {
  if (!rpcUrl) return res.status(503).json({ error: "Robinhood RPC is unavailable" });
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const window = rpcWindows.get(ip);
  const usage = !window || now - window.startedAt >= 60_000 ? { startedAt: now, count: 0 } : window;
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  usage.count += calls.length;
  rpcWindows.set(ip, usage);
  if (usage.count > 180) return res.status(429).json({ error: "Wallet RPC rate limit exceeded" });
  if (!calls.length || calls.some((call) => !call || !walletRpcMethods.has(call.method))) {
    return res.status(400).json({ error: "Unsupported wallet RPC method" });
  }
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await upstream.text();
    res.status(upstream.status).type("application/json").send(body);
  } catch {
    res.status(502).json({ error: "Robinhood RPC request failed" });
  }
});

app.get("/api/status", (_req, res) => res.json({
  ok: true,
  mode,
  chainId,
  vaultAddress,
  proofSystem: "groth16",
  treeDepth: 20,
  contractsReady: mode === "live" && Boolean(vaultAddress && rpcUrl),
  relayerReady: Boolean(relayer),
  marketKeeperReady: Boolean(marketKeeper),
  state: store.snapshot(),
}));

app.get("/api/token/:address", async (req, res) => {
  const address = req.params.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: "Invalid token contract" });
  const key = address.toLowerCase();
  if (tokenCache.has(key)) return res.json(tokenCache.get(key));
  try {
    const [name, symbol, decimals] = await Promise.all([
      readClient.readContract({ address, abi: tokenAbi, functionName: "name" }),
      readClient.readContract({ address, abi: tokenAbi, functionName: "symbol" }),
      readClient.readContract({ address, abi: tokenAbi, functionName: "decimals" }),
    ]);
    const metadata = { address, name, symbol, decimals: Number(decimals) };
    if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 36) throw new Error("Unsupported token decimals");
    tokenCache.set(key, metadata);
    return res.json(metadata);
  } catch {
    return res.status(404).json({ error: "Token metadata could not be read on Robinhood Chain" });
  }
});

app.get("/api/route/:tokenIn/:tokenOut", async (req, res) => {
  const { tokenIn, tokenOut } = req.params;
  if (!vaultAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenIn) || !/^0x[0-9a-fA-F]{40}$/.test(tokenOut) || tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return res.status(400).json({ error: "Invalid route pair" });
  }
  try {
    const router = await readClient.readContract({ address: vaultAddress, abi: marketConfigAbi, functionName: "marketAdapter" });
    const adapter = await activeRoute(router, tokenIn, tokenOut);
    return res.json({ tokenIn, tokenOut, router, adapter, approved: adapter !== ZERO });
  } catch { return res.status(404).json({ error: "No approved execution route was found" }); }
});

const routeJobs = new Map();
app.post("/api/route/:tokenIn/:tokenOut/ensure", async (req, res) => {
  const { tokenIn, tokenOut } = req.params;
  if (!vaultAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenIn) || !/^0x[0-9a-fA-F]{40}$/.test(tokenOut) || tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return res.status(400).json({ error: "Invalid route pair" });
  }
  const key = `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
  try {
    if (!routeJobs.has(key)) routeJobs.set(key, ensureRoute(tokenIn, tokenOut).finally(() => routeJobs.delete(key)));
    return res.json({ tokenIn, tokenOut, ...(await routeJobs.get(key)) });
  } catch (error) {
    return res.status(422).json({ error: error.shortMessage || error.message || "No executable route was found" });
  }
});

app.get("/api/tree/path/:index", (req, res) => {
  try {
    const index = Number(req.params.index);
    const proof = store.tree().proof(index);
    res.json({ index, root: String(proof.root), pathElements: proof.pathElements.map(String), pathIndices: proof.pathIndices });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/case-study", (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(root, "public", "case-study-data.json"), "utf8")));
  } catch {
    res.status(503).json({ error: "Case study evidence is unavailable" });
  }
});

app.get("/api/market/order/:orderId", async (req, res) => {
  if (!vaultAddress) return res.status(503).json({ error: "The live vault is not configured" });
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.orderId)) {
    return res.status(400).json({ error: "Invalid market order id" });
  }
  try {
    const order = await readClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "getMarketOrder",
      args: [req.params.orderId],
    });
    const fromBlock = BigInt(process.env.ZKTX_START_BLOCK || 0);
    const eventNames = ["MarketOrderOpened", "MarketSliceExecuted", "MarketOrderSettled"];
    const [opened, slices, settled] = await Promise.all(eventNames.map((eventName) => readClient.getContractEvents({
      address: vaultAddress,
      abi: vaultAbi,
      eventName,
      args: { orderId: req.params.orderId },
      fromBlock,
      toBlock: "latest",
    })));
    return res.json({
      ...Object.fromEntries(
      Object.entries(order).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
      ),
      openingTransaction: opened.at(-1)?.transactionHash || null,
      sliceTransactions: slices.map((event) => event.transactionHash),
      settlementTransaction: settled.at(-1)?.transactionHash || null,
    });
  } catch {
    return res.status(404).json({ error: "Market order could not be read" });
  }
});

const relayWindows = new Map();
app.post("/api/relay", async (req, res) => {
  if (!relayer) {
    return res.status(503).json({ error: "Relaying is disabled until audited verifiers and the vault are deployed" });
  }
  const now = Date.now();
  const previous = relayWindows.get(req.ip) || [];
  const recent = previous.filter((time) => now - time < 60_000);
  if (recent.length >= 5) return res.status(429).json({ error: "Relay rate limit exceeded" });
  recent.push(now);
  relayWindows.set(req.ip, recent);
  try {
    const transactionHash = await relayer.relay(req.body);
    return res.status(202).json({ transactionHash });
  } catch (error) {
    return res.status(400).json({ error: error.shortMessage || error.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, mode }));
app.listen(port, "127.0.0.1", () => console.log(`zktx listening on ${port} (${mode})`));
