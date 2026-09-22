import { createNote, serializePrivateNote, parsePrivateNote } from "../src/notes.js";
import { planWithdrawals } from "../src/withdrawal-plan.js";
import { poseidon2 } from "poseidon-lite";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";

const STORE_KEY = "zktx.encrypted-notes.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
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
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(serializePrivateNote(privateNote)));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptNote(encrypted, password) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const key = await passwordKey(password, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(encrypted.ciphertext));
  return parsePrivateNote(decoder.decode(plaintext));
}

export function storedNotes() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
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
  const notes = storedNotes();
  notes.unshift(record);
  localStorage.setItem(STORE_KEY, JSON.stringify(notes));
  return record;
}

const vaultAbi = parseAbi([
  "function supportedAssets(address) view returns (bool)",
  "function reserveCaps(address) view returns (uint256)",
  "function publicReserves(address) view returns (uint256)",
  "function deposit(bytes proof,address asset,uint256 amount,bytes32 commitment,bytes32 newRoot)",
]);
const tokenAbi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const hex32 = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

function insertedRoot(commitment, pathElements, pathIndices) {
  let value = BigInt(commitment);
  for (let i = 0; i < pathElements.length; i += 1) {
    const sibling = BigInt(pathElements[i]);
    value = Number(pathIndices[i]) === 0 ? poseidon2([value, sibling]) : poseidon2([sibling, value]);
  }
  return value;
}

async function rpc(method, params) {
  if (!window.ethereum) throw new Error("Install MetaMask or another EVM wallet");
  return window.ethereum.request({ method, params });
}

async function waitForReceipt(hash, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error(`Transaction reverted: ${hash}`);
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Transaction was not confirmed in time: ${hash}`);
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

export async function shieldLive({ account, chainId, vaultAddress, asset, amount, password, onProgress = () => {} }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress || "")) throw new Error("Live pilot vault is unavailable");
  const currentChain = Number(await rpc("eth_chainId"));
  if (currentChain !== Number(chainId)) throw new Error(`Switch your wallet to Robinhood Chain (${chainId}) first`);

  const supportedRaw = await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "supportedAssets", args: [asset] }));
  if (BigInt(supportedRaw) !== 1n) throw new Error("This asset is not enabled in the capped experimental vault");
  const cap = BigInt(await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "reserveCaps", args: [asset] })));
  const reserve = BigInt(await ethCall(vaultAddress, encodeFunctionData({ abi: vaultAbi, functionName: "publicReserves", args: [asset] })));
  if (cap === 0n || reserve + amount > cap) throw new Error("This deposit exceeds the experimental reserve cap");

  onProgress("Building the zero-knowledge deposit proof…");
  const statusResponse = await fetch("./api/status", { cache: "no-store" });
  const status = await statusResponse.json();
  if (!statusResponse.ok || !status.contractsReady) throw new Error("The live pilot indexer is not ready");
  const index = Number(status.state.leafCount);
  const pathResponse = await fetch(`./api/tree/path/${index}`, { cache: "no-store" });
  const path = await pathResponse.json();
  if (!pathResponse.ok) throw new Error(path.error || "Could not load the current Merkle path");

  const created = createNote({ chainId: BigInt(chainId), vaultAddress, asset, amount });
  created.index = index;
  // Prove that the note can be encrypted and persisted before any irreversible wallet action.
  const preparedRecord = await prepareEncryptedNote(created, password);
  const newRoot = insertedRoot(created.commitment, path.pathElements, path.pathIndices);
  if (!window.snarkjs?.groth16) throw new Error("The browser proof engine did not load");
  const proofResult = await window.snarkjs.groth16.fullProve({
    oldRoot: BigInt(path.root), newRoot, commitment: created.commitment, insertionIndex: index,
    assetId: BigInt(asset), amount, chainId: BigInt(chainId), vaultAddress: BigInt(vaultAddress),
    ownerPublicKey: created.note.ownerPublicKey, blinding: created.note.blinding,
    pathElements: path.pathElements.map(BigInt), pathIndices: path.pathIndices,
  }, "./proving/deposit.wasm", "./proving/deposit_final.zkey");
  const exported = await window.snarkjs.groth16.exportSolidityCallData(proofResult.proof, proofResult.publicSignals);
  const [a, b, c] = JSON.parse(`[${exported}]`);
  const proof = encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [a.map(BigInt), b.map((row) => row.map(BigInt)), c.map(BigInt)],
  );

  onProgress("Approve the token in your wallet (step 1 of 2)…");
  const approvalHash = await rpc("eth_sendTransaction", [{
    from: account, to: asset,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [vaultAddress, amount] }),
  }]);
  await waitForReceipt(approvalHash);

  // Re-read immediately before broadcast; another deposit may have advanced the tree while the proof was built.
  const fresh = await (await fetch("./api/status", { cache: "no-store" })).json();
  if (Number(fresh.state.leafCount) !== index || BigInt(fresh.state.root) !== BigInt(path.root)) {
    throw new Error("The pool changed while your proof was being prepared. Your approval is safe; submit again to rebuild the proof.");
  }
  onProgress("Confirm the shield deposit in your wallet (step 2 of 2)…");
  const depositHash = await rpc("eth_sendTransaction", [{
    from: account, to: vaultAddress,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [proof, asset, amount, hex32(created.commitment), hex32(newRoot)] }),
  }]);
  const receipt = await waitForReceipt(depositHash);
  const record = commitEncryptedNote(preparedRecord);
  return { record, approvalHash, depositHash, receipt };
}

export function clearStoredNotes() {
  localStorage.removeItem(STORE_KEY);
}

window.ZKTXWallet = { createEncryptedNote, prepareEncryptedNote, commitEncryptedNote, storeEncryptedNote, shieldLive, decryptNote, storedNotes, clearStoredNotes, planWithdrawals };
