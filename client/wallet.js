import { createNote, serializePrivateNote, parsePrivateNote } from "../src/notes.js";

const STORE_KEY = "zktx.encrypted-notes.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function passwordKey(password, salt, usage) {
  if (password.length < 10) throw new Error("Use a password with at least 10 characters");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptNote(privateNote, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(serializePrivateNote(privateNote)));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptNote(encrypted, password) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const key = await passwordKey(password, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(encrypted.ciphertext));
  return parsePrivateNote(decoder.decode(plaintext));
}

export function storedNotes() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}

export async function createEncryptedNote(input, password) {
  const privateNote = createNote(input);
  const encrypted = await encryptNote(privateNote, password);
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), commitment: privateNote.commitment.toString(), encrypted };
  const notes = storedNotes();
  notes.unshift(record);
  localStorage.setItem(STORE_KEY, JSON.stringify(notes));
  return record;
}

export function clearStoredNotes() {
  localStorage.removeItem(STORE_KEY);
}

window.ZKTXWallet = { createEncryptedNote, decryptNote, storedNotes, clearStoredNotes };
