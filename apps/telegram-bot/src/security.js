import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress } from "viem";

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseEncryptedWalletEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Encrypted wallet envelope required");
  for (const field of ["privateKey", "private_key", "mnemonic", "seed", "password", "passphrase"])
    if (field in value) throw new Error("Plaintext secrets are rejected");
  if (value.version !== 1 || value.kdf !== "PBKDF2-SHA256") throw new Error("Unsupported encryption format");
  if (typeof value.address !== "string" || !isAddress(value.address)) throw new Error("Invalid wallet address");
  if (!Number.isSafeInteger(value.kdfIterations) || value.kdfIterations < 600_000 || value.kdfIterations > 2_000_000) throw new Error("Unsafe KDF work factor");
  for (const field of ["ciphertext", "iv", "salt"])
    if (typeof value[field] !== "string" || value[field].length < 16 || value[field].length > 8192 || !base64.test(value[field])) throw new Error(`Invalid ${field}`);
  return { version: 1, address: getAddress(value.address), ciphertext: value.ciphertext, iv: value.iv, salt: value.salt, kdf: "PBKDF2-SHA256", kdfIterations: value.kdfIterations };
}

export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 300) {
  const params = new URLSearchParams(initData);
  const received = params.get("hash");
  if (!received || !/^[a-f0-9]{64}$/i.test(received)) throw new Error("Invalid Telegram signature");
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(received, "hex"))) throw new Error("Invalid Telegram signature");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) throw new Error("Expired Telegram session");
  const user = JSON.parse(params.get("user") || "null");
  if (!user || !Number.isSafeInteger(user.id)) throw new Error("Telegram user invalid");
  return { id: user.id, firstName: String(user.first_name || "") };
}
