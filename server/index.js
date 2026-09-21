import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/state-store.js";
import { createIndexer } from "../src/indexer.js";
import { createRelayer } from "../src/relayer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const port = Number(process.env.PORT || 3478);
const mode = process.env.PROTOCOL_MODE === "live" ? "live" : "preview";
const chainId = 4663;
const vaultAddress = process.env.ZKTX_VAULT_ADDRESS || null;
const rpcUrl = process.env.RH_RPC_URL || null;
const store = new StateStore(process.env.ZKTX_STATE_FILE || path.join(root, "data", "state.json"));
await store.load();
let indexer = null;
let relayer = null;
if (mode === "live" && vaultAddress && rpcUrl) {
  indexer = createIndexer({ rpcUrl, vaultAddress, store, startBlock: BigInt(process.env.ZKTX_START_BLOCK || 0) });
  await indexer.sync();
  setInterval(() => indexer.sync().catch((error) => console.error("indexer", error.message)), 12_000).unref();
  if (process.env.ZKTX_RELAYER_PRIVATE_KEY) relayer = createRelayer({ rpcUrl, vaultAddress, privateKey: process.env.ZKTX_RELAYER_PRIVATE_KEY, chainId });
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
  state: store.snapshot(),
}));

app.get("/api/tree/path/:index", (req, res) => {
  try {
    const index = Number(req.params.index);
    const proof = store.tree().proof(index);
    res.json({ index, root: String(proof.root), pathElements: proof.pathElements.map(String), pathIndices: proof.pathIndices });
  } catch (error) { res.status(400).json({ error: error.message }); }
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
