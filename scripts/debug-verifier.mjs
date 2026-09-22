import fs from "node:fs/promises";
import path from "node:path";
import { groth16 } from "snarkjs";
import { createPublicClient, http, parseAbi } from "viem";
import { IncrementalMerkleTree } from "../src/merkle-tree.js";
import { createNote } from "../src/notes.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const tree = new IncrementalMerkleTree(20);
const vaultAddress = "0x1111111111111111111111111111111111111111";
const asset = "0x2222222222222222222222222222222222222222";
const created = createNote({ chainId: 4663n, vaultAddress, asset, amount: 500n, ownerSecret: 123n, blinding: 456n });
const insertion = tree.proof(0), oldRoot = tree.root(); tree.insert(created.commitment);
const input = { oldRoot, newRoot: tree.root(), commitment: created.commitment, insertionIndex: 0,
  assetId: BigInt(asset), amount: created.note.amount, chainId: created.note.chainId,
  vaultAddress: BigInt(vaultAddress), ownerPublicKey: created.note.ownerPublicKey, blinding: created.note.blinding,
  pathElements: insertion.pathElements, pathIndices: insertion.pathIndices };
const { proof, publicSignals } = await groth16.fullProve(input, path.join(root,"build/circuits/deposit_js/deposit.wasm"), path.join(root,"build/dev-keys/deposit_final.zkey"));
const exported = await groth16.exportSolidityCallData(proof, publicSignals);
const [a,b,c,signals] = JSON.parse(`[${exported}]`);
const abi = parseAbi(["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[8]) view returns(bool)"]);
for (const target of JSON.parse(process.env.VERIFIER_TARGETS || "[]")) {
  const client = createPublicClient({ transport: http(target.rpc) });
  const variants = {
    exported: b,
    columnsFlipped: b.map(row => [row[1], row[0]]),
    rowsFlipped: [b[1], b[0]],
    rowsAndColumnsFlipped: [b[1].slice().reverse(), b[0].slice().reverse()],
  };
  for (const [encoding, candidate] of Object.entries(variants)) {
    const valid = await client.readContract({ address: target.address, abi, functionName:"verifyProof", args:[a.map(BigInt),candidate.map(r=>r.map(BigInt)),c.map(BigInt),signals.map(BigInt)] });
    console.log(JSON.stringify({name:target.name,encoding,valid}));
  }
}
