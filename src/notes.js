import { poseidon1, poseidon3, poseidon4, poseidon6 } from "poseidon-lite";

export const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function field(value) {
  const result = BigInt(value);
  if (result < 0n || result >= SNARK_FIELD) throw new Error("Value is outside the SNARK field");
  return result;
}

export function addressField(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Invalid EVM address");
  return BigInt(address);
}

export function randomField() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result % SNARK_FIELD;
}

export function ownerPublicKey(ownerSecret) {
  return poseidon1([field(ownerSecret)]);
}

export function noteCommitment(note) {
  return poseidon6([
    field(note.chainId),
    addressField(note.vaultAddress),
    addressField(note.asset),
    field(note.amount),
    field(note.ownerPublicKey),
    field(note.blinding),
  ]);
}

export function noteNullifier(note, ownerSecret) {
  return poseidon4([
    noteCommitment(note),
    field(ownerSecret),
    field(note.chainId),
    addressField(note.vaultAddress),
  ]);
}

export function marketSettlementKey(ownerPublicKeyValue, outputBlinding, refundBlinding) {
  return poseidon3([field(ownerPublicKeyValue), field(outputBlinding), field(refundBlinding)]);
}

export function createNote({ chainId, vaultAddress, asset, amount, ownerSecret = randomField(), blinding = randomField() }) {
  const note = {
    version: 1,
    chainId: field(chainId),
    vaultAddress,
    asset,
    amount: field(amount),
    ownerPublicKey: ownerPublicKey(ownerSecret),
    blinding: field(blinding),
  };
  return { note, ownerSecret: field(ownerSecret), commitment: noteCommitment(note) };
}

export function serializePrivateNote({ note, ownerSecret, commitment, index = null }) {
  return JSON.stringify({
    note: Object.fromEntries(Object.entries(note).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
    ownerSecret: ownerSecret.toString(),
    commitment: commitment.toString(),
    index,
  });
}

export function parsePrivateNote(serialized) {
  const value = JSON.parse(serialized);
  return {
    note: {
      ...value.note,
      version: Number(value.note.version),
      chainId: BigInt(value.note.chainId),
      amount: BigInt(value.note.amount),
      ownerPublicKey: BigInt(value.note.ownerPublicKey),
      blinding: BigInt(value.note.blinding),
    },
    ownerSecret: BigInt(value.ownerSecret),
    commitment: BigInt(value.commitment),
    index: value.index,
  };
}
