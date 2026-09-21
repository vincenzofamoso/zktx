import fs from "node:fs/promises";
import path from "node:path";
import { IncrementalMerkleTree } from "./merkle-tree.js";

export class StateStore {
  constructor(filename, depth = 20) {
    this.filename = filename;
    this.depth = depth;
    this.state = { leaves: [], nullifiers: [], lastBlock: 0 };
  }

  async load() {
    try { this.state = JSON.parse(await fs.readFile(this.filename, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return this.snapshot();
  }

  tree() { return new IncrementalMerkleTree(this.depth, this.state.leaves.map(BigInt)); }

  snapshot() {
    const tree = this.tree();
    return { ...this.state, leafCount: tree.leaves.length, root: tree.root().toString() };
  }

  async save() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.filename);
  }

  async recordCommitment(commitment, blockNumber = this.state.lastBlock) {
    if (this.state.leaves.includes(String(commitment))) return this.snapshot();
    this.state.leaves.push(String(commitment));
    this.state.lastBlock = Math.max(this.state.lastBlock, Number(blockNumber));
    await this.save();
    return this.snapshot();
  }

  async recordNullifier(nullifier, blockNumber = this.state.lastBlock) {
    if (!this.state.nullifiers.includes(String(nullifier))) this.state.nullifiers.push(String(nullifier));
    this.state.lastBlock = Math.max(this.state.lastBlock, Number(blockNumber));
    await this.save();
    return this.snapshot();
  }
}
