import test from "node:test";
import assert from "node:assert/strict";
import { createNote, noteCommitment, noteNullifier, parsePrivateNote, serializePrivateNote } from "../src/notes.js";

const vaultAddress = "0x1111111111111111111111111111111111111111";
const asset = "0x2222222222222222222222222222222222222222";

test("note commitments and nullifiers are deterministic and domain bound", () => {
  const first = createNote({ chainId: 4663n, vaultAddress, asset, amount: 25n, ownerSecret: 7n, blinding: 9n });
  const second = createNote({ chainId: 4663n, vaultAddress, asset, amount: 25n, ownerSecret: 7n, blinding: 9n });
  assert.equal(first.commitment, second.commitment);
  assert.equal(noteCommitment(first.note), first.commitment);
  assert.equal(noteNullifier(first.note, first.ownerSecret), noteNullifier(second.note, second.ownerSecret));
  const otherChain = createNote({ chainId: 1n, vaultAddress, asset, amount: 25n, ownerSecret: 7n, blinding: 9n });
  assert.notEqual(first.commitment, otherChain.commitment);
});

test("private notes round-trip without losing field values", () => {
  const created = createNote({ chainId: 4663n, vaultAddress, asset, amount: 123n, ownerSecret: 11n, blinding: 17n });
  const parsed = parsePrivateNote(serializePrivateNote(created));
  assert.deepEqual(parsed, { ...created, index: null });
});
