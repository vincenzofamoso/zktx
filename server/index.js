import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/state-store.js";
import { createIndexer } from "../src/indexer.js";
import { createRelayer } from "../src/relayer.js";
import { createMarketKeeper } from "../src/market-keeper.js";
import { vaultAbi } from "../src/vault-abi.js";
import { createPublicClient, http, parseAbi } from "viem";

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
const tokenCache = new Map();
const store = new StateStore(process.env.ZKTX_STATE_FILE || path.join(root, "data", "state.json"));
await store.load();
let indexer = null;
let relayer = null;
let marketKeeper = null;
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
    });
    setInterval(() => marketKeeper.tick().catch((error) => console.error("market keeper", error.message)), 1_000).unref();
  }
}

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

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

app.get("/api/tree/path/:index", (req, res) => {
  try {
    const index = Number(req.params.index);
    const proof = store.tree().proof(index);
    res.json({ index, root: String(proof.root), pathElements: proof.pathElements.map(String), pathIndices: proof.pathIndices });
  } catch (error) { res.status(400).json({ error: error.message }); }
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
    return res.json(Object.fromEntries(
      Object.entries(order).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
    ));
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
