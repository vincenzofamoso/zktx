import fs from "node:fs/promises";
import path from "node:path";
import { groth16 } from "snarkjs";
import { poseidon1, poseidon4, poseidon6 } from "poseidon-lite";
import {
  createPublicClient, createWalletClient, encodeAbiParameters, http, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import {
  createNote, noteCommitment, noteNullifier, SNARK_FIELD,
} from "../src/notes.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const rpcUrl = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const walletFile = process.env.ZKTX_E2E_WALLETS;
const runDir = process.env.ZKTX_E2E_RUN_DIR;
if (!walletFile || !runDir) throw new Error("ZKTX_E2E_WALLETS and ZKTX_E2E_RUN_DIR are required");

const vaultAddress = process.env.ZKTX_VAULT_ADDRESS;
const assetA = process.env.ZKTX_TOKEN_A;
const assetB = process.env.ZKTX_TOKEN_B;
for (const [name, value] of Object.entries({ vaultAddress, assetA, assetB })) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value || "")) throw new Error(`Invalid ${name}`);
}

const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const stored = JSON.parse(await fs.readFile(walletFile, "utf8"));
const accounts = Object.fromEntries(stored.wallets.map(({ role, private_key }) => [role, privateKeyToAccount(private_key)]));
const clients = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, createWalletClient({ account, chain, transport: http(rpcUrl) })]));
const tree = new IncrementalMerkleTree(20);
const transactions = [];
const checks = [];
const chainId = 4663n;
const vault = BigInt(vaultAddress);
const unit = 10n ** 18n;

const vaultAbi = parseAbi([
  "function depositVerifier() view returns (address)",
  "function currentRoot() view returns (bytes32)",
  "function noteCount() view returns (uint256)",
  "function publicReserves(address) view returns (uint256)",
  "function deposit(bytes proof,address asset,uint256 amount,bytes32 commitment,bytes32 newRoot)",
  "function transact(bytes proof,bytes32 oldRoot,bytes32 newRoot,bytes32 nullifier,bytes32 outputOne,bytes32 outputTwo)",
  "function withdraw(bytes proof,bytes32 root,address asset,address recipient,uint256 amount,bytes32 nullifier)",
  "function settleSwap(bytes proof,bytes32 oldRoot,bytes32 newRoot,bytes32 makerNullifier,bytes32 takerNullifier,bytes32 makerOutput,bytes32 takerOutput,bytes32 changeOutput,uint256 deadline)",
  "function cancelOrder(bytes proof,bytes32 oldRoot,bytes32 newRoot,bytes32 orderNullifier,bytes32 refundCommitment)",
]);
const tokenAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const depositVerifierAbi = parseAbi([
  "function verifyProof(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256[8] input) view returns (bool)",
]);

const hex32 = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);

function inverse(value) {
  let a = ((value % SNARK_FIELD) + SNARK_FIELD) % SNARK_FIELD;
  let b = SNARK_FIELD, x = 1n, y = 0n;
  while (a !== 0n) [a, b, x, y] = [b % a, a, y - (b / a) * x, x];
  if (b !== 1n) throw new Error("No field inverse");
  return ((y % SNARK_FIELD) + SNARK_FIELD) % SNARK_FIELD;
}

async function prove(name, input) {
  const wasm = path.join(root, `build/circuits/${name}_js/${name}.wasm`);
  const zkey = path.join(root, `build/dev-keys/${name}_final.zkey`);
  const result = await groth16.fullProve(input, wasm, zkey);
  const verificationKey = JSON.parse(await fs.readFile(path.join(root, `build/dev-keys/${name}_verification_key.json`), "utf8"));
  if (!(await groth16.verify(verificationKey, result.publicSignals, result.proof))) {
    throw new Error(`${name} proof failed offchain verification`);
  }
  const exported = await groth16.exportSolidityCallData(result.proof, result.publicSignals);
  const [a, b, c] = JSON.parse(`[${exported}]`);
  return {
    encoded: encodeAbiParameters(
      [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
      [a.map(BigInt), b.map(row => row.map(BigInt)), c.map(BigInt)],
    ),
    publicSignals: result.publicSignals,
    solidity: { a: a.map(BigInt), b: b.map(row => row.map(BigInt)), c: c.map(BigInt) },
  };
}

async function send(role, label, address, abi, functionName, args) {
  const account = accounts[role];
  const request = await publicClient.simulateContract({ account, address, abi, functionName, args });
  const hash = await clients[role].writeContract(request.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  transactions.push({ label, role, hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, address });
  console.log(`${label}: ${hash}`);
  return receipt;
}

async function approve(role, asset, amount, label) {
  await send(role, label, asset, tokenAbi, "approve", [vaultAddress, amount]);
}

async function deposit(role, asset, amount, created, label) {
  const index = tree.leaves.length;
  const insertion = tree.proof(index);
  const oldRoot = tree.root();
  tree.insert(created.commitment);
  const newRoot = tree.root();
  const proof = await prove("deposit", {
    oldRoot, newRoot, commitment: created.commitment, insertionIndex: index,
    assetId: BigInt(asset), amount, chainId, vaultAddress: vault,
    ownerPublicKey: created.note.ownerPublicKey, blinding: created.note.blinding,
    pathElements: insertion.pathElements, pathIndices: insertion.pathIndices,
  });
  const verifier = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "depositVerifier" });
  const expectedSignals = [oldRoot, newRoot, created.commitment, BigInt(index), BigInt(asset), amount, chainId, vault];
  const proofSignals = proof.publicSignals.map(BigInt);
  if (json(expectedSignals) !== json(proofSignals)) {
    throw new Error(`${label}: circuit public-signal order differs from vault ABI\nexpected=${json(expectedSignals)}\nactual=${json(proofSignals)}`);
  }
  const validOnchain = await publicClient.readContract({ address: verifier, abi: depositVerifierAbi, functionName: "verifyProof", args: [
    proof.solidity.a, proof.solidity.b, proof.solidity.c,
    proofSignals,
  ] });
  if (!validOnchain) {
    const flippedB = proof.solidity.b.map(row => [row[1], row[0]]);
    const validFlipped = await publicClient.readContract({ address: verifier, abi: depositVerifierAbi, functionName: "verifyProof", args: [
      proof.solidity.a, flippedB, proof.solidity.c,
      proofSignals,
    ] });
    if (!validFlipped) throw new Error(`${label}: proof passed offchain but failed deployed verifier in both G2 encodings`);
    proof.solidity.b = flippedB;
    proof.encoded = encodeAbiParameters(
      [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
      [proof.solidity.a, proof.solidity.b, proof.solidity.c],
    );
  }
  await send(role, label, vaultAddress, vaultAbi, "deposit", [proof.encoded, asset, amount, hex32(created.commitment), hex32(newRoot)]);
  created.index = index;
  return created;
}

const startingBalances = {
  aliceA: await publicClient.readContract({ address: assetA, abi: tokenAbi, functionName: "balanceOf", args: [accounts.alice.address] }),
  bobB: await publicClient.readContract({ address: assetB, abi: tokenAbi, functionName: "balanceOf", args: [accounts.bob.address] }),
  receiverA: await publicClient.readContract({ address: assetA, abi: tokenAbi, functionName: "balanceOf", args: [accounts.fresh_receiver.address] }),
};

await approve("alice", assetA, 100n * unit, "Alice approves token A");
await approve("bob", assetB, 100n * unit, "Bob approves token B");

const aliceInput = await deposit("alice", assetA, 10n * unit,
  createNote({ chainId, vaultAddress, asset: assetA, amount: 10n * unit }), "Alice shields 10 token A");
await deposit("bob", assetB, 20n * unit,
  createNote({ chainId, vaultAddress, asset: assetB, amount: 20n * unit }), "Bob shields 20 token B");

const oldTransferRoot = tree.root();
const inputPath = tree.proof(aliceInput.index);
const aliceChange = createNote({ chainId, vaultAddress, asset: assetA, amount: 6n * unit });
const receiverNote = createNote({ chainId, vaultAddress, asset: assetA, amount: 4n * unit });
const insertionOne = tree.proof(tree.leaves.length); tree.insert(aliceChange.commitment); aliceChange.index = tree.leaves.length - 1;
const insertionTwo = tree.proof(tree.leaves.length); tree.insert(receiverNote.commitment); receiverNote.index = tree.leaves.length - 1;
const transferNullifier = noteNullifier(aliceInput.note, aliceInput.ownerSecret);
const transferProof = await prove("transfer", {
  oldRoot: oldTransferRoot, newRoot: tree.root(), nullifier: transferNullifier,
  outputCommitmentOne: aliceChange.commitment, outputCommitmentTwo: receiverNote.commitment,
  insertionIndexOne: aliceChange.index, insertionIndexTwo: receiverNote.index, chainId, vaultAddress: vault,
  ownerSecret: aliceInput.ownerSecret, assetId: BigInt(assetA), inputAmount: aliceInput.note.amount,
  inputBlinding: aliceInput.note.blinding, inputPathElements: inputPath.pathElements, inputPathIndices: inputPath.pathIndices,
  outputOwnerOne: aliceChange.note.ownerPublicKey, outputAmountOne: aliceChange.note.amount, outputBlindingOne: aliceChange.note.blinding,
  outputOwnerTwo: receiverNote.note.ownerPublicKey, outputAmountTwo: receiverNote.note.amount, outputBlindingTwo: receiverNote.note.blinding,
  insertionPathOneElements: insertionOne.pathElements, insertionPathOneIndices: insertionOne.pathIndices,
  insertionPathTwoElements: insertionTwo.pathElements, insertionPathTwoIndices: insertionTwo.pathIndices,
});
await send("relayer", "Relayed private transfer", vaultAddress, vaultAbi, "transact", [
  transferProof.encoded, hex32(oldTransferRoot), hex32(tree.root()), hex32(transferNullifier), hex32(aliceChange.commitment), hex32(receiverNote.commitment),
]);

const withdrawalRoot = tree.root();
const withdrawalPath = tree.proof(receiverNote.index);
const withdrawalNullifier = noteNullifier(receiverNote.note, receiverNote.ownerSecret);
const withdrawalProof = await prove("withdraw", {
  root: withdrawalRoot, nullifier: withdrawalNullifier, assetId: BigInt(assetA), recipient: BigInt(accounts.fresh_receiver.address),
  amount: receiverNote.note.amount, chainId, vaultAddress: vault, ownerSecret: receiverNote.ownerSecret,
  blinding: receiverNote.note.blinding, pathElements: withdrawalPath.pathElements, pathIndices: withdrawalPath.pathIndices,
});
await send("relayer", "Relayed withdrawal to fresh receiver", vaultAddress, vaultAbi, "withdraw", [
  withdrawalProof.encoded, hex32(withdrawalRoot), assetA, accounts.fresh_receiver.address, receiverNote.note.amount, hex32(withdrawalNullifier),
]);

const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
const cancelSecret = 901n, orderNonce = 902n, makerBlinding = 903n;
const cancelPublicKey = poseidon1([cancelSecret]);
const sellAmount = 5n * unit, buyAmount = 3n * unit;
const makerReceive = createNote({ chainId, vaultAddress, asset: assetB, amount: buyAmount });
const orderOwner = poseidon6([BigInt(assetB), buyAmount, makerReceive.note.ownerPublicKey, deadline, orderNonce, cancelPublicKey]);
const makerOrderNote = { chainId, vaultAddress, asset: assetA, amount: sellAmount, ownerPublicKey: orderOwner, blinding: makerBlinding };
const makerOrder = { note: makerOrderNote, ownerSecret: orderOwner, commitment: noteCommitment(makerOrderNote) };
await deposit("alice", assetA, sellAmount, makerOrder, "Alice shields private RFQ order");
const takerInput = await deposit("bob", assetB, 7n * unit,
  createNote({ chainId, vaultAddress, asset: assetB, amount: 7n * unit }), "Bob shields RFQ liquidity");

const oldSwapRoot = tree.root();
const makerPath = tree.proof(makerOrder.index), takerPath = tree.proof(takerInput.index);
const takerReceive = createNote({ chainId, vaultAddress, asset: assetA, amount: sellAmount });
const change = createNote({ chainId, vaultAddress, asset: assetB, amount: 4n * unit });
const makerInsertion = tree.proof(tree.leaves.length); tree.insert(makerReceive.commitment); makerReceive.index = tree.leaves.length - 1;
const takerInsertion = tree.proof(tree.leaves.length); tree.insert(takerReceive.commitment); takerReceive.index = tree.leaves.length - 1;
const changeInsertion = tree.proof(tree.leaves.length); tree.insert(change.commitment); change.index = tree.leaves.length - 1;
const makerNullifier = poseidon4([makerOrder.commitment, orderOwner, chainId, vault]);
const takerNullifier = noteNullifier(takerInput.note, takerInput.ownerSecret);
const swapProof = await prove("swap", {
  oldRoot: oldSwapRoot, newRoot: tree.root(), makerNullifier, takerNullifier,
  makerOutputCommitment: makerReceive.commitment, takerOutputCommitment: takerReceive.commitment, changeCommitment: change.commitment,
  makerOutputIndex: makerReceive.index, takerOutputIndex: takerReceive.index, changeIndex: change.index, chainId, vaultAddress: vault, deadline,
  cancelPublicKey, orderNonce, sellAsset: BigInt(assetA), sellAmount, buyAsset: BigInt(assetB), buyAmount,
  makerReceiveOwner: makerReceive.note.ownerPublicKey, makerOrderBlinding: makerOrderNote.blinding,
  makerPathElements: makerPath.pathElements, makerPathIndices: makerPath.pathIndices,
  takerOwnerSecret: takerInput.ownerSecret, takerInputAmount: takerInput.note.amount, takerInputBlinding: takerInput.note.blinding,
  takerPathElements: takerPath.pathElements, takerPathIndices: takerPath.pathIndices,
  takerReceiveOwner: takerReceive.note.ownerPublicKey, makerOutputBlinding: makerReceive.note.blinding,
  takerOutputBlinding: takerReceive.note.blinding, changeOwner: change.note.ownerPublicKey, changeAmount: change.note.amount,
  changeBlinding: change.note.blinding, distinctNullifierInverse: inverse(makerNullifier - takerNullifier),
  makerInsertionElements: makerInsertion.pathElements, makerInsertionIndices: makerInsertion.pathIndices,
  takerInsertionElements: takerInsertion.pathElements, takerInsertionIndices: takerInsertion.pathIndices,
  changeInsertionElements: changeInsertion.pathElements, changeInsertionIndices: changeInsertion.pathIndices,
});
await send("relayer", "Relayed private RFQ swap", vaultAddress, vaultAbi, "settleSwap", [
  swapProof.encoded, hex32(oldSwapRoot), hex32(tree.root()), hex32(makerNullifier), hex32(takerNullifier),
  hex32(makerReceive.commitment), hex32(takerReceive.commitment), hex32(change.commitment), deadline,
]);

const cancelDeadline = deadline + 3600n, cancelSecretTwo = 1901n, orderNonceTwo = 1902n;
const cancelPublicTwo = poseidon1([cancelSecretTwo]);
const cancelReceive = createNote({ chainId, vaultAddress, asset: assetB, amount: 1n * unit });
const cancelOwner = poseidon6([BigInt(assetB), 1n * unit, cancelReceive.note.ownerPublicKey, cancelDeadline, orderNonceTwo, cancelPublicTwo]);
const cancellableNote = { chainId, vaultAddress, asset: assetA, amount: 1n * unit, ownerPublicKey: cancelOwner, blinding: 1903n };
const cancellable = { note: cancellableNote, ownerSecret: cancelOwner, commitment: noteCommitment(cancellableNote) };
await deposit("alice", assetA, 1n * unit, cancellable, "Alice shields cancellable RFQ order");
const oldCancelRoot = tree.root(), cancelPath = tree.proof(cancellable.index);
const refund = createNote({ chainId, vaultAddress, asset: assetA, amount: 1n * unit });
const refundInsertion = tree.proof(tree.leaves.length); tree.insert(refund.commitment); refund.index = tree.leaves.length - 1;
const orderNullifier = poseidon4([cancellable.commitment, cancelOwner, chainId, vault]);
const cancelProof = await prove("cancel-order", {
  oldRoot: oldCancelRoot, newRoot: tree.root(), orderNullifier, refundCommitment: refund.commitment, refundIndex: refund.index,
  chainId, vaultAddress: vault, cancelSecret: cancelSecretTwo, orderNonce: orderNonceTwo, sellAsset: BigInt(assetA), sellAmount: 1n * unit,
  buyAsset: BigInt(assetB), buyAmount: 1n * unit, makerReceiveOwner: cancelReceive.note.ownerPublicKey, deadline: cancelDeadline,
  makerOrderBlinding: cancellableNote.blinding, makerPathElements: cancelPath.pathElements, makerPathIndices: cancelPath.pathIndices,
  refundOwner: refund.note.ownerPublicKey, refundBlinding: refund.note.blinding,
  insertionElements: refundInsertion.pathElements, insertionIndices: refundInsertion.pathIndices,
});
await send("relayer", "Relayed private order cancellation", vaultAddress, vaultAbi, "cancelOrder", [
  cancelProof.encoded, hex32(oldCancelRoot), hex32(tree.root()), hex32(orderNullifier), hex32(refund.commitment),
]);

try {
  await publicClient.simulateContract({ account: accounts.relayer, address: vaultAddress, abi: vaultAbi, functionName: "transact", args: [
    transferProof.encoded, hex32(oldTransferRoot), hex32(tree.root()), hex32(transferNullifier), hex32(aliceChange.commitment), hex32(receiverNote.commitment),
  ] });
  checks.push({ name: "nullifier replay rejected", passed: false });
} catch { checks.push({ name: "nullifier replay rejected", passed: true }); }

const finalRoot = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "currentRoot" });
const noteCount = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "noteCount" });
const reserveA = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "publicReserves", args: [assetA] });
const reserveB = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "publicReserves", args: [assetB] });
const receiverBalance = await publicClient.readContract({ address: assetA, abi: tokenAbi, functionName: "balanceOf", args: [accounts.fresh_receiver.address] });
checks.push({ name: "onchain root equals locally derived root", passed: finalRoot.toLowerCase() === hex32(tree.root()).toLowerCase() });
checks.push({ name: "fresh receiver obtained withdrawn token A", passed: receiverBalance - startingBalances.receiverA === 4n * unit });

const report = {
  generatedAt: new Date().toISOString(), network: "Robinhood Chain", chainId: 4663,
  warning: "Capped E2E run using development proving keys and valueless test assets; not a production ceremony or audit.",
  contracts: { vault: vaultAddress, tokenA: assetA, tokenB: assetB },
  participants: Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, account.address])),
  transactions, checks, finalState: { root: finalRoot, localRoot: hex32(tree.root()), noteCount, reserveA, reserveB, receiverBalance },
};
await fs.writeFile(path.join(runDir, "e2e-report-private.json"), json(report), { mode: 0o600 });
const publicReport = { ...report, participants: undefined };
await fs.writeFile(path.join(root, "public", "case-study-data.json"), json(publicReport));
console.log(json({ transactions: transactions.length, checks, finalState: report.finalState }));
