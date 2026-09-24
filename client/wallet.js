import {
  SNARK_FIELD,
  createNote,
  marketSettlementKey,
  noteCommitment,
  noteNullifier,
  ownerPublicKey,
  randomField,
  serializePrivateNote,
  parsePrivateNote,
} from "../src/notes.js";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import { planWithdrawals } from "../src/withdrawal-plan.js";
import { poseidon2 } from "poseidon-lite";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";

const STORE_KEY = "zktx.encrypted-notes.v1";
const MARKET_STORE_KEY = "zktx.market-orders.v1";
const RECEIVE_IDENTITY_KEY = "zktx.receive-identity.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const runtime = globalThis.ZKTX_RUNTIME_CONFIG || {};
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const apiUrl = (pathname) => `${runtime.apiBase || "."}${pathname}`;
const provingUrl = (filename) => `${runtime.provingBase || "./proving"}/${filename}`;

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64Url(bytes) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  return base64ToBytes(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4));
}

async function newReceiveIdentity() {
  const ownerSecret = randomField();
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { ownerSecret: ownerSecret.toString(), privateKey: base64Url(privateKey), publicKey: base64Url(publicKey) };
}

async function receiveIdentityRecord(password, create = false) {
  let encrypted;
  try { encrypted = JSON.parse(localStorage.getItem(RECEIVE_IDENTITY_KEY) || "null"); } catch {}
  if (!encrypted && !create) throw new Error("Create your private receive address first");
  if (!encrypted) {
    const identity = await newReceiveIdentity();
    encrypted = await encryptText(JSON.stringify(identity), password);
    localStorage.setItem(RECEIVE_IDENTITY_KEY, JSON.stringify(encrypted));
    return identity;
  }
  const plaintext = await decryptText(encrypted, password);
  if (plaintext.startsWith("{")) return JSON.parse(plaintext);
  const identity = await newReceiveIdentity();
  identity.ownerSecret = plaintext;
  localStorage.setItem(RECEIVE_IDENTITY_KEY, JSON.stringify(await encryptText(JSON.stringify(identity), password)));
  return identity;
}

function parsePrivateAddress(address) {
  const [prefix, owner, encryptionKey] = String(address || "").split(":");
  if (prefix !== "zktx1" || !/^0x[0-9a-fA-F]{64}$/.test(owner) || !encryptionKey) throw new Error("Enter a valid ZKTX private receive address");
  return { owner, encryptionKey };
}

async function passwordKey(password, salt, usage) {
  if (password.length < 10) throw new Error("Use a password with at least 10 characters");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptNote(privateNote, password) {
  return encryptText(serializePrivateNote(privateNote), password);
}

async function encryptText(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptNote(encrypted, password) {
  return parsePrivateNote(await decryptText(encrypted, password));
}

async function decryptText(encrypted, password) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const key = await passwordKey(password, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(encrypted.ciphertext));
  return decoder.decode(plaintext);
}

export function storedNotes() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}

export function storedMarketOrders() {
  try { return JSON.parse(localStorage.getItem(MARKET_STORE_KEY) || "[]"); } catch { return []; }
}

export async function privatePortfolio(password) {
  const entries = [];
  for (const record of storedNotes()) {
    if (record.spentBy) continue;
    try {
      const note = await decryptNote(record.encrypted, password);
      if (note.note.amount === 0n) continue;
      entries.push({
        id: record.id,
        commitment: record.commitment,
        createdAt: record.createdAt,
        asset: note.note.asset,
        amount: note.note.amount.toString(),
        index: note.index,
      });
    } catch { /* A different password or corrupt record must not expose other notes. */ }
  }
  return entries;
}

export async function privateReceiveAddress(password) {
  const identity = await receiveIdentityRecord(password, true);
  return `zktx1:${hex32(ownerPublicKey(BigInt(identity.ownerSecret)))}:${identity.publicKey}`;
}

async function receiveIdentity(password) {
  const identity = await receiveIdentityRecord(password);
  const ownerSecret = BigInt(identity.ownerSecret);
  return { ...identity, ownerSecret, ownerPublicKey: ownerPublicKey(ownerSecret) };
}

async function encryptInboxPayload(receipt, recipientPublicKey) {
  const recipient = await crypto.subtle.importKey("raw", fromBase64Url(recipientPublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: recipient }, ephemeral.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(receipt));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  return { version: 1, ephemeralKey: base64Url(publicKey), iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) };
}

async function decryptInboxPayload(envelope, privateKey) {
  const ownKey = await crypto.subtle.importKey("pkcs8", fromBase64Url(privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const ephemeral = await crypto.subtle.importKey("raw", fromBase64Url(envelope.ephemeralKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: ephemeral }, ownKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(envelope.iv) }, key, fromBase64Url(envelope.ciphertext));
  return decoder.decode(plaintext);
}

export async function createEncryptedNote(input, password) {
  const privateNote = createNote(input);
  return storeEncryptedNote(privateNote, password);
}

export async function storeEncryptedNote(privateNote, password) {
  const record = await prepareEncryptedNote(privateNote, password);
  return commitEncryptedNote(record);
}

export async function prepareEncryptedNote(privateNote, password) {
  const encrypted = await encryptNote(privateNote, password);
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), commitment: privateNote.commitment.toString(), encrypted };
}

export function commitEncryptedNote(record) {
  const notes = storedNotes().filter((item) => item.id !== record.id);
  notes.unshift(record);
  localStorage.setItem(STORE_KEY, JSON.stringify(notes));
  return record;
}

const vaultAbi = parseAbi([
  "function supportedAssets(address) view returns (bool)",
  "function reserveCaps(address) view returns (uint256)",
  "function publicReserves(address) view returns (uint256)",
  "function deposit(bytes proof,address asset,uint256 amount,bytes32 commitment,bytes32 newRoot)",
  "function openMarketOrder(bytes proof,bytes32 root,address assetIn,uint256 amountIn,address assetOut,uint256 minimumAmountOut,bytes32 nullifier,bytes32 settlementKey,uint256 deadline)",
]);
const tokenAbi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)", "function balanceOf(address owner) view returns (uint256)"]);
const hex32 = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

function insertedRoot(commitment, pathElements, pathIndices) {
  let value = BigInt(commitment);
  for (let i = 0; i < pathElements.length; i += 1) {
    const sibling = BigInt(pathElements[i]);
    value = Number(pathIndices[i]) === 0 ? poseidon2([value, sibling]) : poseidon2([sibling, value]);
  }
  return value;
}

function noteMatchesPath(privateNote, path) {
  return insertedRoot(privateNote.commitment, path.pathElements, path.pathIndices) === BigInt(path.root);
}

async function loadMerklePath(index) {
  const response = await fetch(apiUrl(`/api/tree/path/${index}`), { cache: "no-store" });
  const path = await response.json();
  if (!response.ok) throw new Error(path.error || "Could not load the note's Merkle path");
  return path;
}

async function waitForIndexedNote(privateNote, timeoutMs = 48_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const path = await loadMerklePath(privateNote.index);
      if (noteMatchesPath(privateNote, path)) return true;
    } catch { /* The indexer may not have reached the confirmed deposit yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function rpc(method, params) {
  if (!window.ethereum) throw new Error("Install MetaMask or another EVM wallet");
  return window.ethereum.request({ method, params });
}

async function waitForReceipt(hash, timeoutMs = 180_000, stage = "Transaction") {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error(`${stage} reverted on Robinhood Chain: ${hash}`);
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${stage} was not confirmed on Robinhood Chain: ${hash}`);
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

async function protocolStatus() {
  const response = await fetch(apiUrl("/api/status"), { cache: "no-store" });
  const status = await response.json();
  if (!response.ok) throw new Error(status.error || "Protocol status is unavailable");
  return status;
}

async function relay(payload) {
  const response = await fetch(apiUrl("/api/relay"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The relayer rejected the proof");
  return result.transactionHash;
}

function proofBytes(proof, publicSignals) {
  return window.snarkjs.groth16.exportSolidityCallData(proof, publicSignals).then((exported) => {
    const [a, b, c] = JSON.parse(`[${exported}]`);
    return encodeAbiParameters(
      [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
      [a.map(BigInt), b.map((row) => row.map(BigInt)), c.map(BigInt)],
    );
  });
}

function mod(value) {
  const result = BigInt(value) % SNARK_FIELD;
  return result < 0n ? result + SNARK_FIELD : result;
}

function modularInverse(value) {
  let base = mod(value);
  if (base === 0n) throw new Error("Input and output assets must differ");
  let exponent = SNARK_FIELD - 2n;
  let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = result * base % SNARK_FIELD;
    base = base * base % SNARK_FIELD;
    exponent >>= 1n;
  }
  return result;
}

function markNoteSpent(id, orderId) {
  const notes = storedNotes();
  const record = notes.find((item) => item.id === id);
  if (record) {
    record.spentBy = orderId;
    localStorage.setItem(STORE_KEY, JSON.stringify(notes));
  }
}

function saveMarketOrder(record) {
  const records = storedMarketOrders().filter((item) => item.orderId !== record.orderId);
  records.unshift(record);
  localStorage.setItem(MARKET_STORE_KEY, JSON.stringify(records));
}

export async function shieldLive({ account, chainId, vaultAddress, asset, amount, password, onProgress = () => {} }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress || "")) throw new Error("Live vault is unavailable");
  const currentChain = Number(await rpc("eth_chainId"));
  if (currentChain !== Number(chainId)) throw new Error(`Switch your wallet to Robinhood Chain (${chainId}) first`);

  onProgress("Checking token availability in the shielded vault...");
  const enableResponse = await fetch(apiUrl(`/api/assets/${asset}/ensure`), { method: "POST" });
  const enableResult = await enableResponse.json();
  if (!enableResponse.ok) throw new Error(enableResult.error || "This token could not be enabled in the shielded vault");
  const supportedRaw = await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "supportedAssets", args: [asset] }));
  if (BigInt(supportedRaw) !== 1n) throw new Error("This token is not enabled in the shielded vault");
  const cap = BigInt(await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "reserveCaps", args: [asset] })));
  const reserve = BigInt(await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "publicReserves", args: [asset] })));
  if (cap === 0n || reserve + amount > cap) throw new Error("This token is temporarily unavailable for shielding");

  let tokenBalance = BigInt(await ethCall(asset, encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [account] })));
  if (tokenBalance < amount && asset.toLowerCase() === WETH.toLowerCase()) {
    const shortfall = amount - tokenBalance;
    const nativeBalance = BigInt(await rpc("eth_getBalance", [account, "latest"]));
    if (nativeBalance <= shortfall) {
      throw new Error("Not enough RH ETH to wrap the requested WETH amount and retain gas");
    }
    onProgress("Confirm wrapping RH ETH into WETH (step 1 of 3)...");
    const wrapHash = await rpc("eth_sendTransaction", [{
      from: account,
      to: WETH,
      value: `0x${shortfall.toString(16)}`,
      data: "0xd0e30db0",
    }]);
    await waitForReceipt(wrapHash, 180_000, "WETH wrapping");
    onProgress("WETH wrapping confirmed", { transactionHash: wrapHash });
    tokenBalance = BigInt(await ethCall(asset, encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [account] })));
  }
  if (tokenBalance < amount) {
    throw new Error(`Insufficient token balance. Wallet has ${tokenBalance} base units but this shield requires ${amount}`);
  }

  onProgress("Building the zero-knowledge deposit proof…");
  const statusResponse = await fetch(apiUrl("/api/status"), { cache: "no-store" });
  const status = await statusResponse.json();
  if (!statusResponse.ok || !status.contractsReady) throw new Error("The live pilot indexer is not ready");
  const index = Number(status.state.leafCount);
  const pathResponse = await fetch(apiUrl(`/api/tree/path/${index}`), { cache: "no-store" });
  const path = await pathResponse.json();
  if (!pathResponse.ok) throw new Error(path.error || "Could not load the current Merkle path");

  const created = createNote({ chainId: BigInt(chainId), vaultAddress, asset, amount });
  created.index = index;
  const preparedRecord = await prepareEncryptedNote(created, password);
  const newRoot = insertedRoot(created.commitment, path.pathElements, path.pathIndices);
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  const proofResult = await window.snarkjs.groth16.fullProve({
    oldRoot: BigInt(path.root), newRoot, commitment: created.commitment, insertionIndex: index,
    assetId: BigInt(asset), amount, chainId: BigInt(chainId), vaultAddress: BigInt(vaultAddress),
    ownerPublicKey: created.note.ownerPublicKey, blinding: created.note.blinding,
    pathElements: path.pathElements.map(BigInt), pathIndices: path.pathIndices,
  }, provingUrl("deposit.wasm"), provingUrl("deposit_final.zkey"));
  const exported = await window.snarkjs.groth16.exportSolidityCallData(proofResult.proof, proofResult.publicSignals);
  const [a, b, c] = JSON.parse(`[${exported}]`);
  const proof = encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [a.map(BigInt), b.map((row) => row.map(BigInt)), c.map(BigInt)],
  );

  onProgress("Approve the token in your wallet...");
  const approvalHash = await rpc("eth_sendTransaction", [{
    from: account, to: asset,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [vaultAddress, amount] }),
  }]);
  await waitForReceipt(approvalHash, 180_000, "Token approval");
  onProgress("Token approval confirmed", { transactionHash: approvalHash });

  // Refresh the root before broadcast.
  const fresh = await (await fetch(apiUrl("/api/status"), { cache: "no-store" })).json();
  if (Number(fresh.state.leafCount) !== index || BigInt(fresh.state.root) !== BigInt(path.root)) {
    throw new Error("The pool changed while your proof was being prepared. Your approval is safe; submit again to rebuild the proof.");
  }
  onProgress("Confirm the shield deposit in your wallet...");
  const depositHash = await rpc("eth_sendTransaction", [{
    from: account, to: vaultAddress,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [proof, asset, amount, hex32(created.commitment), hex32(newRoot)] }),
  }]);
  const receipt = await waitForReceipt(depositHash, 180_000, "Shield deposit");
  onProgress("Shield deposit confirmed onchain", { transactionHash: depositHash });
  const record = commitEncryptedNote(preparedRecord);
  onProgress("Deposit confirmed. Syncing your private balance...");
  const indexed = await waitForIndexedNote(created);
  return { record, approvalHash, depositHash, receipt, indexed };
}

export async function openMarketOrderLive({
  chainId,
  vaultAddress,
  assetIn,
  amountIn,
  assetOut,
  minimumAmountOut,
  deadline,
  password,
  onProgress = () => {},
}) {
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  if (assetIn.toLowerCase() === assetOut.toLowerCase()) throw new Error("Input and output assets must differ");
  const status = await protocolStatus();
  if (!status.contractsReady || !status.relayerReady || !status.marketKeeperReady) {
    throw new Error("The market-order relayer or keeper is not ready");
  }
  onProgress("Checking RH liquidity and activating the swap route if needed...");
  const routeResponse = await fetch(apiUrl(`/api/route/${assetIn}/${assetOut}/ensure`), { method: "POST" });
  const route = await routeResponse.json();
  if (!routeResponse.ok || !route.approved) throw new Error(route.error || "No executable RH liquidity route was found for this pair");

  onProgress("Unlocking the matching local shielded note…");
  let selectedRecord;
  let input;
  let path;
  let foundMatchingLocalNote = false;
  for (const record of storedNotes()) {
    if (record.spentBy) continue;
    try {
      const candidate = await decryptNote(record.encrypted, password);
      if (
        candidate.note.asset.toLowerCase() === assetIn.toLowerCase()
        && candidate.note.amount === BigInt(amountIn)
        && candidate.index !== null
      ) {
        foundMatchingLocalNote = true;
        const candidatePath = await loadMerklePath(candidate.index);
        if (noteMatchesPath(candidate, candidatePath)) {
          selectedRecord = record;
          input = candidate;
          path = candidatePath;
          break;
        }
      }
    } catch { /* Keep looking; one wrong/corrupt record must not block the wallet. */ }
  }
  if (!input) {
    if (foundMatchingLocalNote) throw new Error("This local note is not in the current vault tree. If you just shielded it, wait a few seconds and try again.");
    throw new Error("No unspent local note exactly matches this token and amount");
  }
  const outputOwnerSecret = randomField();
  const outputOwnerPublicKey = ownerPublicKey(outputOwnerSecret);
  const outputBlinding = randomField();
  const refundBlinding = randomField();
  const settlementKey = marketSettlementKey(outputOwnerPublicKey, outputBlinding, refundBlinding);
  const nullifier = noteNullifier(input.note, input.ownerSecret);
  const expires = BigInt(deadline);

  onProgress("Building the private market-order proof…");
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve({
    root: BigInt(path.root),
    nullifier,
    assetIn: BigInt(assetIn),
    amountIn: BigInt(amountIn),
    assetOut: BigInt(assetOut),
    minimumAmountOut: BigInt(minimumAmountOut),
    settlementKey,
    deadline: expires,
    chainId: BigInt(chainId),
    vaultAddress: BigInt(vaultAddress),
    ownerSecret: input.ownerSecret,
    inputBlinding: input.note.blinding,
    inputPathElements: path.pathElements.map(BigInt),
    inputPathIndices: path.pathIndices,
    outputOwnerPublicKey,
    outputBlinding,
    refundBlinding,
    distinctAssetInverse: modularInverse(BigInt(assetIn) - BigInt(assetOut)),
  }, provingUrl("market-order.wasm"), provingUrl("market-order_final.zkey"));
  const encodedProof = await proofBytes(proof, publicSignals);
  const orderId = hex32(nullifier);
  const secret = {
    version: 1,
    orderId,
    inputRecordId: selectedRecord.id,
    outputOwnerSecret: outputOwnerSecret.toString(),
    outputOwnerPublicKey: outputOwnerPublicKey.toString(),
    outputBlinding: outputBlinding.toString(),
    refundBlinding: refundBlinding.toString(),
    assetIn,
    assetOut,
    amountIn: BigInt(amountIn).toString(),
    minimumAmountOut: BigInt(minimumAmountOut).toString(),
    deadline: expires.toString(),
  };
  // Persist recovery data before submission.
  const encrypted = await encryptText(JSON.stringify(secret), password);
  const record = {
    orderId,
    createdAt: new Date().toISOString(),
    transactionHash: null,
    settled: false,
    encrypted,
  };
  saveMarketOrder(record);

  onProgress("Relaying the private order to the execution vault…");
  const transactionHash = await relay({
    action: "market-order",
    proof: encodedProof,
    root: hex32(path.root),
    assetIn,
    amountIn: BigInt(amountIn).toString(),
    assetOut,
    minimumAmountOut: BigInt(minimumAmountOut).toString(),
    nullifier: orderId,
    settlementKey: hex32(settlementKey),
    deadline: expires.toString(),
  });
  record.transactionHash = transactionHash;
  saveMarketOrder(record);
  await waitForReceipt(transactionHash);
  onProgress("Private market order confirmed onchain", { transactionHash, orderId });
  markNoteSpent(selectedRecord.id, orderId);
  return record;
}

export async function privateSendLive({
  chainId,
  vaultAddress,
  asset,
  amount,
  recipientPrivateAddress,
  password,
  onProgress = () => {},
}) {
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  const recipientAddress = parsePrivateAddress(recipientPrivateAddress);
  const recipientOwner = BigInt(recipientAddress.owner);
  if (recipientOwner <= 0n || recipientOwner >= SNARK_FIELD) throw new Error("Enter a valid ZKTX private receive address");
  const status = await protocolStatus();
  if (!status.contractsReady || !status.relayerReady) throw new Error("The private-send relayer is not ready");

  onProgress("Unlocking the matching private note...");
  let selectedRecord;
  let input;
  let inputPath;
  for (const record of storedNotes()) {
    if (record.spentBy) continue;
    try {
      const candidate = await decryptNote(record.encrypted, password);
      if (
        candidate.note.chainId === BigInt(chainId)
        && candidate.note.vaultAddress.toLowerCase() === vaultAddress.toLowerCase()
        && candidate.note.asset.toLowerCase() === asset.toLowerCase()
        && candidate.note.amount === BigInt(amount)
        && candidate.index !== null
      ) {
        const path = await loadMerklePath(candidate.index);
        if (noteMatchesPath(candidate, path)) { selectedRecord = record; input = candidate; inputPath = path; break; }
      }
    } catch { /* Continue searching notes protected by this password. */ }
  }
  if (!input) throw new Error("No spendable private note exactly matches this token and amount");

  const tree = new IncrementalMerkleTree(status.treeDepth, status.state.leaves.map(BigInt));
  if (tree.root() !== BigInt(status.state.root)) throw new Error("The private-note tree is still synchronizing");
  const change = createNote({ chainId: BigInt(chainId), vaultAddress, asset, amount: 0n });
  const recipientBlinding = randomField();
  const recipientNote = createNote({
    chainId: BigInt(chainId), vaultAddress, asset, amount: BigInt(amount),
    ownerSecret: 1n, blinding: recipientBlinding,
  });
  recipientNote.ownerSecret = 0n;
  recipientNote.note.ownerPublicKey = recipientOwner;
  recipientNote.commitment = noteCommitment(recipientNote.note);
  const insertionOne = tree.proof(tree.leaves.length);
  tree.insert(change.commitment); change.index = tree.leaves.length - 1;
  const insertionTwo = tree.proof(tree.leaves.length);
  tree.insert(recipientNote.commitment); recipientNote.index = tree.leaves.length - 1;
  const nullifier = noteNullifier(input.note, input.ownerSecret);

  onProgress("Building the private transfer proof...");
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve({
    oldRoot: BigInt(inputPath.root), newRoot: tree.root(), nullifier,
    outputCommitmentOne: change.commitment, outputCommitmentTwo: recipientNote.commitment,
    insertionIndexOne: change.index, insertionIndexTwo: recipientNote.index,
    chainId: BigInt(chainId), vaultAddress: BigInt(vaultAddress), ownerSecret: input.ownerSecret,
    assetId: BigInt(asset), inputAmount: input.note.amount, inputBlinding: input.note.blinding,
    inputPathElements: inputPath.pathElements.map(BigInt), inputPathIndices: inputPath.pathIndices,
    outputOwnerOne: change.note.ownerPublicKey, outputAmountOne: change.note.amount, outputBlindingOne: change.note.blinding,
    outputOwnerTwo: recipientOwner, outputAmountTwo: recipientNote.note.amount, outputBlindingTwo: recipientBlinding,
    insertionPathOneElements: insertionOne.pathElements.map(BigInt), insertionPathOneIndices: insertionOne.pathIndices,
    insertionPathTwoElements: insertionTwo.pathElements.map(BigInt), insertionPathTwoIndices: insertionTwo.pathIndices,
  }, provingUrl("transfer.wasm"), provingUrl("transfer_final.zkey"));
  const encodedProof = await proofBytes(proof, publicSignals);
  onProgress("Relaying the private transfer...");
  const transactionHash = await relay({
    action: "transfer", proof: encodedProof, oldRoot: hex32(inputPath.root), newRoot: hex32(tree.root()),
    nullifier: hex32(nullifier), outputOne: hex32(change.commitment), outputTwo: hex32(recipientNote.commitment),
  });
  await waitForReceipt(transactionHash, 180_000, "Private transfer");
  markNoteSpent(selectedRecord.id, transactionHash);
  onProgress("Private transfer confirmed", { transactionHash });
  const receipt = bytesToBase64(encoder.encode(JSON.stringify({
    version: 1,
    note: {
      version: 1, chainId: String(chainId), vaultAddress, asset,
      amount: BigInt(amount).toString(), ownerPublicKey: recipientOwner.toString(), blinding: recipientBlinding.toString(),
    },
    commitment: recipientNote.commitment.toString(), index: recipientNote.index,
  })));
  const envelope = await encryptInboxPayload(receipt, recipientAddress.encryptionKey);
  const response = await fetch(apiUrl("/api/private-inbox"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient: recipientAddress.owner.toLowerCase(), envelope, transactionHash }) });
  if (!response.ok) throw new Error("Transfer confirmed, but automatic delivery could not be queued");
  return { transactionHash };
}

export async function importPrivateTransfer(receipt, password) {
  let payload;
  try { payload = JSON.parse(decoder.decode(base64ToBytes(receipt.trim()))); }
  catch { throw new Error("Enter a valid ZKTX private transfer receipt"); }
  const identity = await receiveIdentity(password);
  if (BigInt(payload.note.ownerPublicKey) !== identity.ownerPublicKey) throw new Error("This transfer was sent to a different ZKTX private address");
  const privateNote = parsePrivateNote(JSON.stringify({ ...payload, ownerSecret: identity.ownerSecret.toString() }));
  if (privateNote.commitment !== noteCommitment(privateNote.note)) throw new Error("The transfer receipt is invalid");
  if (storedNotes().some((record) => record.commitment === privateNote.commitment.toString())) return null;
  const path = await loadMerklePath(privateNote.index);
  if (!noteMatchesPath(privateNote, path)) throw new Error("The private transfer is not indexed yet. Try again in a few seconds");
  return storeEncryptedNote(privateNote, password);
}

export async function syncPrivateInbox(password) {
  const identity = await receiveIdentity(password);
  const recipient = hex32(identity.ownerPublicKey).toLowerCase();
  const response = await fetch(apiUrl(`/api/private-inbox/${recipient}`));
  if (!response.ok) throw new Error("Could not check for private transfers");
  const { messages = [] } = await response.json();
  let imported = 0;
  for (const message of messages) {
    try {
      const receipt = await decryptInboxPayload(message.envelope, identity.privateKey);
      const record = await importPrivateTransfer(receipt, password);
      if (record) imported += 1;
    } catch (error) {
      if (!String(error?.message || "").includes("not indexed yet")) console.warn("private inbox", error);
    }
  }
  return { imported };
}

export async function withdrawLive({
  chainId,
  vaultAddress,
  asset,
  amount,
  recipient,
  password,
  onProgress = () => {},
}) {
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient || "")) throw new Error("Enter a valid destination wallet");
  const status = await protocolStatus();
  if (!status.contractsReady || !status.relayerReady) throw new Error("The withdrawal relayer is not ready");

  onProgress("Unlocking the matching private note...");
  let selectedRecord;
  let input;
  let path;
  for (const record of storedNotes()) {
    if (record.spentBy) continue;
    try {
      const candidate = await decryptNote(record.encrypted, password);
      if (
        candidate.note.chainId === BigInt(chainId)
        && candidate.note.vaultAddress.toLowerCase() === vaultAddress.toLowerCase()
        && candidate.note.asset.toLowerCase() === asset.toLowerCase()
        && candidate.note.amount === BigInt(amount)
        && candidate.index !== null
      ) {
        const candidatePath = await loadMerklePath(candidate.index);
        if (noteMatchesPath(candidate, candidatePath)) {
          selectedRecord = record;
          input = candidate;
          path = candidatePath;
          break;
        }
      }
    } catch { /* Keep searching without exposing notes encrypted by another password. */ }
  }
  if (!input) throw new Error("No spendable private note exactly matches this token and amount");

  const nullifier = noteNullifier(input.note, input.ownerSecret);
  onProgress("Building the private withdrawal proof...");
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve({
    root: BigInt(path.root),
    nullifier,
    assetId: BigInt(asset),
    recipient: BigInt(recipient),
    amount: BigInt(amount),
    chainId: BigInt(chainId),
    vaultAddress: BigInt(vaultAddress),
    ownerSecret: input.ownerSecret,
    blinding: input.note.blinding,
    pathElements: path.pathElements.map(BigInt),
    pathIndices: path.pathIndices,
  }, provingUrl("withdraw.wasm"), provingUrl("withdraw_final.zkey"));
  const encodedProof = await proofBytes(proof, publicSignals);
  onProgress("Relaying the unshield transaction...");
  const transactionHash = await relay({
    action: "withdraw",
    proof: encodedProof,
    root: hex32(path.root),
    asset,
    recipient,
    amount: BigInt(amount).toString(),
    nullifier: hex32(nullifier),
  });
  await waitForReceipt(transactionHash, 180_000, "Unshield withdrawal");
  onProgress("Unshield withdrawal confirmed", { transactionHash });
  markNoteSpent(selectedRecord.id, transactionHash);
  return { transactionHash, recipient, asset, amount: BigInt(amount).toString() };
}

export async function settleMarketOrderLive({ orderId, password, onProgress = () => {} }) {
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  const record = storedMarketOrders().find((item) => item.orderId === orderId && !item.settled);
  if (!record) throw new Error("No pending local market order was found");
  const secret = JSON.parse(await decryptText(record.encrypted, password));
  const status = await protocolStatus();
  if (!status.relayerReady) throw new Error("The settlement relayer is not ready");

  const orderResponse = await fetch(apiUrl(`/api/market/order/${orderId}`), { cache: "no-store" });
  const order = await orderResponse.json();
  if (!orderResponse.ok) throw new Error(order.error || "Could not load the market order");
  if (order.settled) {
    if (!record.preparedOutputs?.length) throw new Error("This order is already settled onchain");
    for (const prepared of record.preparedOutputs) {
      const preparedNote = await decryptNote(prepared.encrypted, password);
      if (preparedNote.note.amount > 0n) commitEncryptedNote(prepared);
    }
    record.settled = true;
    delete record.preparedOutputs;
    saveMarketOrder(record);
    return { transactionHash: record.settlementHash, recovered: true };
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const readyAt = BigInt(order.executedInput) === BigInt(order.amountIn)
    ? BigInt(order.lastExecutionAt) + 30n
    : BigInt(order.deadline) + 30n;
  if (now < readyAt) throw new Error(`Settlement becomes available in ${readyAt - now} seconds`);

  onProgress("Building the two private settlement notes…");
  const tree = new IncrementalMerkleTree(20, status.state.leaves.map(BigInt));
  const oldRoot = tree.root();
  const outputIndex = tree.leaves.length;
  const output = createNote({
    chainId: BigInt(status.chainId),
    vaultAddress: status.vaultAddress,
    asset: order.assetOut,
    amount: BigInt(order.netAmountOut),
    ownerSecret: BigInt(secret.outputOwnerSecret),
    blinding: BigInt(secret.outputBlinding),
  });
  output.index = outputIndex;
  const outputPath = tree.proof(outputIndex);
  tree.insert(output.commitment);
  const refundIndex = tree.leaves.length;
  const refundAmount = BigInt(order.amountIn) - BigInt(order.executedInput);
  const refund = createNote({
    chainId: BigInt(status.chainId),
    vaultAddress: status.vaultAddress,
    asset: order.assetIn,
    amount: refundAmount,
    ownerSecret: BigInt(secret.outputOwnerSecret),
    blinding: BigInt(secret.refundBlinding),
  });
  refund.index = refundIndex;
  const refundPath = tree.proof(refundIndex);
  tree.insert(refund.commitment);
  const outputRecord = await prepareEncryptedNote(output, password);
  const refundRecord = refundAmount > 0n ? await prepareEncryptedNote(refund, password) : null;
  // Persist recovery data before settlement.
  record.preparedOutputs = refundRecord ? [outputRecord, refundRecord] : [outputRecord];
  saveMarketOrder(record);

  onProgress("Building the market-settlement proof…");
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve({
    oldRoot,
    newRoot: tree.root(),
    outputCommitment: output.commitment,
    refundCommitment: refund.commitment,
    outputIndex,
    refundIndex,
    settlementKey: BigInt(order.settlementKey),
    assetOut: BigInt(order.assetOut),
    netAmountOut: BigInt(order.netAmountOut),
    assetIn: BigInt(order.assetIn),
    refundAmount,
    chainId: BigInt(status.chainId),
    vaultAddress: BigInt(status.vaultAddress),
    orderNullifier: BigInt(orderId),
    outputOwnerPublicKey: BigInt(secret.outputOwnerPublicKey),
    outputBlinding: BigInt(secret.outputBlinding),
    refundBlinding: BigInt(secret.refundBlinding),
    outputInsertionElements: outputPath.pathElements,
    outputInsertionIndices: outputPath.pathIndices,
    refundInsertionElements: refundPath.pathElements,
    refundInsertionIndices: refundPath.pathIndices,
  }, provingUrl("market-settlement.wasm"), provingUrl("market-settlement_final.zkey"));
  const encodedProof = await proofBytes(proof, publicSignals);
  onProgress("Relaying the private settlement…");
  const transactionHash = await relay({
    action: "market-settlement",
    proof: encodedProof,
    orderId,
    oldRoot: hex32(oldRoot),
    newRoot: hex32(tree.root()),
    outputCommitment: hex32(output.commitment),
    refundCommitment: hex32(refund.commitment),
  });
  record.settlementHash = transactionHash;
  saveMarketOrder(record);
  await waitForReceipt(transactionHash);
  onProgress("Private settlement confirmed onchain", { transactionHash, orderId });
  commitEncryptedNote(outputRecord);
  if (refundRecord) commitEncryptedNote(refundRecord);
  record.settled = true;
  delete record.preparedOutputs;
  saveMarketOrder(record);
  return { transactionHash, outputRecord, refundRecord };
}

export function clearStoredNotes() {
  localStorage.removeItem(STORE_KEY);
}

window.ZKTXWallet = {
  createEncryptedNote,
  prepareEncryptedNote,
  commitEncryptedNote,
  storeEncryptedNote,
  shieldLive,
  privateSendLive,
  privateReceiveAddress,
  importPrivateTransfer,
  openMarketOrderLive,
  withdrawLive,
  settleMarketOrderLive,
  decryptNote,
  storedNotes,
  storedMarketOrders,
  privatePortfolio,
  clearStoredNotes,
  planWithdrawals,
};
