import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { poseidon1, poseidon4, poseidon6 } from "poseidon-lite";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import { createNote, noteCommitment, noteNullifier, SNARK_FIELD } from "../src/notes.js";

const vaultAddress = "0x1111111111111111111111111111111111111111";
const asset = "0x2222222222222222222222222222222222222222";
const secondAsset = "0x3333333333333333333333333333333333333333";

function inverse(value) {
  let a = ((value % SNARK_FIELD) + SNARK_FIELD) % SNARK_FIELD;
  let b = SNARK_FIELD;
  let x = 1n;
  let y = 0n;
  while (a !== 0n) [a, b, x, y] = [b % a, a, y - (b / a) * x, x];
  if (b !== 1n) throw new Error("No field inverse");
  return ((y % SNARK_FIELD) + SNARK_FIELD) % SNARK_FIELD;
}

async function witness(name, input) {
  const source = await fs.readFile(new URL(`../build/circuits/${name}_js/witness_calculator.js`, import.meta.url), "utf8");
  const module = { exports: {} };
  Function("module", "exports", source)(module, module.exports);
  const builder = module.exports;
  const wasm = await fs.readFile(new URL(`../build/circuits/${name}_js/${name}.wasm`, import.meta.url));
  const calculator = await builder(wasm);
  return calculator.calculateWitness(input, true);
}

test("deposit and withdrawal circuits accept a bound note lifecycle", async () => {
  const tree = new IncrementalMerkleTree(20);
  const { note, ownerSecret, commitment } = createNote({ chainId: 4663n, vaultAddress, asset, amount: 500n, ownerSecret: 123n, blinding: 456n });
  const insertion = tree.proof(0);
  const oldRoot = tree.root();
  tree.insert(commitment);
  const newRoot = tree.root();

  const depositWitness = await witness("deposit", {
    oldRoot, newRoot, commitment, insertionIndex: 0,
    assetId: BigInt(asset), amount: note.amount, chainId: note.chainId,
    vaultAddress: BigInt(vaultAddress), ownerPublicKey: note.ownerPublicKey, blinding: note.blinding,
    pathElements: insertion.pathElements, pathIndices: insertion.pathIndices,
  });
  assert.ok(depositWitness.length > 1);

  const membership = tree.proof(0);
  const nullifier = noteNullifier(note, ownerSecret);
  const withdrawalWitness = await witness("withdraw", {
    root: newRoot, nullifier, assetId: BigInt(asset), recipient: 333n, amount: note.amount,
    chainId: note.chainId, vaultAddress: BigInt(vaultAddress), ownerSecret, blinding: note.blinding,
    pathElements: membership.pathElements, pathIndices: membership.pathIndices,
  });
  assert.ok(withdrawalWitness.length > 1);
});

test("transfer circuit conserves value and appends two private outputs", async () => {
  const tree = new IncrementalMerkleTree(20);
  const input = createNote({ chainId: 4663n, vaultAddress, asset, amount: 500n, ownerSecret: 123n, blinding: 456n });
  tree.insert(input.commitment);
  const oldRoot = tree.root();
  const membership = tree.proof(0);
  const first = createNote({ chainId: 4663n, vaultAddress, asset, amount: 300n, ownerSecret: 789n, blinding: 111n });
  const second = createNote({ chainId: 4663n, vaultAddress, asset, amount: 200n, ownerSecret: 321n, blinding: 222n });
  const insertionOne = tree.proof(1);
  tree.insert(first.commitment);
  const insertionTwo = tree.proof(2);
  tree.insert(second.commitment);

  const transferWitness = await witness("transfer", {
    oldRoot, newRoot: tree.root(), nullifier: noteNullifier(input.note, input.ownerSecret),
    outputCommitmentOne: first.commitment, outputCommitmentTwo: second.commitment,
    insertionIndexOne: 1, insertionIndexTwo: 2, chainId: 4663n, vaultAddress: BigInt(vaultAddress),
    ownerSecret: input.ownerSecret, assetId: BigInt(asset), inputAmount: 500n, inputBlinding: input.note.blinding,
    inputPathElements: membership.pathElements, inputPathIndices: membership.pathIndices,
    outputOwnerOne: first.note.ownerPublicKey, outputAmountOne: 300n, outputBlindingOne: first.note.blinding,
    outputOwnerTwo: second.note.ownerPublicKey, outputAmountTwo: 200n, outputBlindingTwo: second.note.blinding,
    insertionPathOneElements: insertionOne.pathElements, insertionPathOneIndices: insertionOne.pathIndices,
    insertionPathTwoElements: insertionTwo.pathElements, insertionPathTwoIndices: insertionTwo.pathIndices,
  });
  assert.ok(transferWitness.length > 1);
});

test("private RFQ swap circuit exchanges two shielded assets and returns change", async () => {
  const chainId = 4663n;
  const vault = BigInt(vaultAddress);
  const cancelSecret = 901n;
  const cancelPublicKey = poseidon1([cancelSecret]);
  const orderNonce = 902n;
  const deadline = 2_000_000_000n;
  const sellAmount = 300n;
  const buyAmount = 500n;
  const makerReceive = createNote({ chainId, vaultAddress, asset: secondAsset, amount: buyAmount, ownerSecret: 1111n, blinding: 1112n });
  const orderOwner = poseidon6([BigInt(secondAsset), buyAmount, makerReceive.note.ownerPublicKey, deadline, orderNonce, cancelPublicKey]);
  const makerOrderNote = { chainId, vaultAddress, asset, amount: sellAmount, ownerPublicKey: orderOwner, blinding: 903n };
  const makerCommitment = noteCommitment(makerOrderNote);
  const takerInput = createNote({ chainId, vaultAddress, asset: secondAsset, amount: 700n, ownerSecret: 1001n, blinding: 1002n });
  const takerReceive = createNote({ chainId, vaultAddress, asset, amount: sellAmount, ownerSecret: 1201n, blinding: 1202n });
  const change = createNote({ chainId, vaultAddress, asset: secondAsset, amount: 200n, ownerSecret: 1301n, blinding: 1302n });
  const tree = new IncrementalMerkleTree(20, [makerCommitment, takerInput.commitment]);
  const oldRoot = tree.root();
  const makerPath = tree.proof(0);
  const takerPath = tree.proof(1);
  const makerInsertion = tree.proof(2);
  tree.insert(makerReceive.commitment);
  const takerInsertion = tree.proof(3);
  tree.insert(takerReceive.commitment);
  const changeInsertion = tree.proof(4);
  tree.insert(change.commitment);
  const makerNullifier = poseidon4([makerCommitment, orderOwner, chainId, vault]);
  const takerNullifier = noteNullifier(takerInput.note, takerInput.ownerSecret);

  const swapWitness = await witness("swap", {
    oldRoot, newRoot: tree.root(), makerNullifier, takerNullifier,
    makerOutputCommitment: makerReceive.commitment, takerOutputCommitment: takerReceive.commitment,
    changeCommitment: change.commitment, makerOutputIndex: 2, takerOutputIndex: 3, changeIndex: 4,
    chainId, vaultAddress: vault, deadline, cancelPublicKey, orderNonce,
    sellAsset: BigInt(asset), sellAmount, buyAsset: BigInt(secondAsset), buyAmount,
    makerReceiveOwner: makerReceive.note.ownerPublicKey, makerOrderBlinding: makerOrderNote.blinding,
    makerPathElements: makerPath.pathElements, makerPathIndices: makerPath.pathIndices,
    takerOwnerSecret: takerInput.ownerSecret, takerInputAmount: takerInput.note.amount,
    takerInputBlinding: takerInput.note.blinding, takerPathElements: takerPath.pathElements,
    takerPathIndices: takerPath.pathIndices, takerReceiveOwner: takerReceive.note.ownerPublicKey,
    makerOutputBlinding: makerReceive.note.blinding, takerOutputBlinding: takerReceive.note.blinding,
    changeOwner: change.note.ownerPublicKey, changeAmount: change.note.amount, changeBlinding: change.note.blinding,
    distinctNullifierInverse: inverse(makerNullifier - takerNullifier),
    makerInsertionElements: makerInsertion.pathElements, makerInsertionIndices: makerInsertion.pathIndices,
    takerInsertionElements: takerInsertion.pathElements, takerInsertionIndices: takerInsertion.pathIndices,
    changeInsertionElements: changeInsertion.pathElements, changeInsertionIndices: changeInsertion.pathIndices,
  });
  assert.ok(swapWitness.length > 1);

  const cancelTree = new IncrementalMerkleTree(20, [makerCommitment, takerInput.commitment]);
  const refund = createNote({ chainId, vaultAddress, asset, amount: sellAmount, ownerSecret: 1401n, blinding: 1402n });
  const refundInsertion = cancelTree.proof(2);
  cancelTree.insert(refund.commitment);
  const cancelWitness = await witness("cancel-order", {
    oldRoot, newRoot: cancelTree.root(), orderNullifier: makerNullifier, refundCommitment: refund.commitment,
    refundIndex: 2, chainId, vaultAddress: vault, cancelSecret, orderNonce, sellAsset: BigInt(asset),
    sellAmount, buyAsset: BigInt(secondAsset), buyAmount, makerReceiveOwner: makerReceive.note.ownerPublicKey,
    deadline, makerOrderBlinding: makerOrderNote.blinding, makerPathElements: makerPath.pathElements,
    makerPathIndices: makerPath.pathIndices, refundOwner: refund.note.ownerPublicKey,
    refundBlinding: refund.note.blinding, insertionElements: refundInsertion.pathElements,
    insertionIndices: refundInsertion.pathIndices,
  });
  assert.ok(cancelWitness.length > 1);
});
