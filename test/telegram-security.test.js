import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseEncryptedWalletEnvelope, verifyTelegramInitData } from "../apps/telegram-bot/src/security.js";

const validEnvelope = {
  version: 1,
  address: "0x1111111111111111111111111111111111111111",
  ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA",
  iv: "AAAAAAAAAAAAAAAA",
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  kdf: "PBKDF2-SHA256",
  kdfIterations: 600_000,
};

test("accepts a valid encrypted wallet envelope", () => {
  assert.equal(parseEncryptedWalletEnvelope(validEnvelope).address, validEnvelope.address);
});

test("rejects plaintext wallet material and weak KDF settings", () => {
  assert.throws(() => parseEncryptedWalletEnvelope({ ...validEnvelope, privateKey: "secret" }), /Plaintext/);
  assert.throws(() => parseEncryptedWalletEnvelope({ ...validEnvelope, kdfIterations: 10 }), /Unsafe/);
});

test("verifies Telegram Mini App init data", () => {
  const token = "123456:test-token", authDate = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "query", user: JSON.stringify({ id: 42, first_name: "Alice" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  assert.equal(verifyTelegramInitData(params.toString(), token).id, 42);
  params.set("hash", "0".repeat(64));
  assert.throws(() => verifyTelegramInitData(params.toString(), token), /signature/);
});
