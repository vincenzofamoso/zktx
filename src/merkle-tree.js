import { poseidon2 } from "poseidon-lite";
import { field } from "./notes.js";

export class IncrementalMerkleTree {
  constructor(depth = 20, leaves = []) {
    this.depth = depth;
    this.capacity = 2 ** depth;
    this.zeros = [0n];
    for (let level = 0; level < depth; level++) this.zeros.push(poseidon2([this.zeros[level], this.zeros[level]]));
    this.leaves = leaves.map(field);
    if (this.leaves.length > this.capacity) throw new Error("Merkle tree capacity exceeded");
  }

  insert(commitment) {
    if (this.leaves.length >= this.capacity) throw new Error("Merkle tree is full");
    const index = this.leaves.length;
    this.leaves.push(field(commitment));
    return { index, root: this.root(), proof: this.proof(index) };
  }

  root() {
    let layer = [...this.leaves];
    for (let level = 0; level < this.depth; level++) {
      const next = [];
      const width = Math.max(1, Math.ceil(layer.length / 2));
      for (let i = 0; i < width; i++) {
        next.push(poseidon2([layer[i * 2] ?? this.zeros[level], layer[i * 2 + 1] ?? this.zeros[level]]));
      }
      layer = next;
    }
    return layer[0] ?? this.zeros[this.depth];
  }

  proof(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) throw new Error("Invalid leaf index");
    const elements = [];
    const indices = [];
    let cursor = index;
    let layer = [...this.leaves];
    for (let level = 0; level < this.depth; level++) {
      elements.push(layer[cursor ^ 1] ?? this.zeros[level]);
      indices.push(cursor & 1);
      const next = [];
      const width = Math.max(1, Math.ceil(layer.length / 2));
      for (let i = 0; i < width; i++) {
        next.push(poseidon2([layer[i * 2] ?? this.zeros[level], layer[i * 2 + 1] ?? this.zeros[level]]));
      }
      layer = next;
      cursor >>= 1;
    }
    return { pathElements: elements, pathIndices: indices, root: layer[0] ?? this.zeros[this.depth] };
  }

  toJSON() {
    return { depth: this.depth, leaves: this.leaves.map(String), root: this.root().toString() };
  }
}
