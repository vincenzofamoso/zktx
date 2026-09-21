import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import { createNote, noteNullifier } from "../src/notes.js";

const vaultAddress = "0x1111111111111111111111111111111111111111";
const asset = "0x2222222222222222222222222222222222222222";

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
