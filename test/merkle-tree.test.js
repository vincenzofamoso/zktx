import test from "node:test";
import assert from "node:assert/strict";
import { poseidon2 } from "poseidon-lite";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";

function applyProof(leaf, proof) {
  let hash = BigInt(leaf);
  for (let i = 0; i < proof.pathElements.length; i++) {
    const sibling = proof.pathElements[i];
    hash = proof.pathIndices[i] ? poseidon2([sibling, hash]) : poseidon2([hash, sibling]);
  }
  return hash;
}

test("tree produces valid membership proofs", () => {
  const tree = new IncrementalMerkleTree(5);
  tree.insert(10n);
  tree.insert(20n);
  tree.insert(30n);
  for (let i = 0; i < 3; i++) assert.equal(applyProof(tree.leaves[i], tree.proof(i)), tree.root());
});

test("empty insertion proof derives the next root", () => {
  const tree = new IncrementalMerkleTree(5, [10n, 20n]);
  const emptyProof = tree.proof(2);
  assert.equal(applyProof(0n, emptyProof), tree.root());
  const expected = new IncrementalMerkleTree(5, [10n, 20n, 30n]).root();
  assert.equal(applyProof(30n, emptyProof), expected);
});
