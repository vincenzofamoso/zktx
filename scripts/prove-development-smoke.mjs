import fs from "node:fs/promises";
import path from "node:path";
import { groth16 } from "snarkjs";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import { createNote } from "../src/notes.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const tree = new IncrementalMerkleTree(20);
const vaultAddress = "0x1111111111111111111111111111111111111111";
const asset = "0x2222222222222222222222222222222222222222";
const created = createNote({ chainId: 4663n, vaultAddress, asset, amount: 500n, ownerSecret: 123n, blinding: 456n });
const insertion = tree.proof(0);
const oldRoot = tree.root();
tree.insert(created.commitment);

const input = {
  oldRoot, newRoot: tree.root(), commitment: created.commitment, insertionIndex: 0,
  assetId: BigInt(asset), amount: created.note.amount, chainId: created.note.chainId,
  vaultAddress: BigInt(vaultAddress), ownerPublicKey: created.note.ownerPublicKey, blinding: created.note.blinding,
  pathElements: insertion.pathElements, pathIndices: insertion.pathIndices,
};
const wasm = path.join(root, "build/circuits/deposit_js/deposit.wasm");
const zkey = path.join(root, "build/dev-keys/deposit_final.zkey");
const verificationKey = JSON.parse(await fs.readFile(path.join(root, "build/dev-keys/deposit_verification_key.json"), "utf8"));
const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
if (!(await groth16.verify(verificationKey, publicSignals, proof))) throw new Error("Development proof verification failed");
console.log(JSON.stringify({ verified: true, publicSignals: publicSignals.length, commitment: created.commitment.toString() }));
