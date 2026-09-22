# ZKTX Telegram bot

Text-first ZKTX workflows with a CURVING-style trusted-device signer. Telegram chat collects action parameters. The Mini App is limited to wallet import/unlock and cryptographic authorization.

The private key is encrypted in the browser with AES-256-GCM and a 600,000-round PBKDF2-SHA256 key. The server stores only the encrypted envelope. A non-exportable decryption key is retained in IndexedDB on the trusted device. Private-note secrets must likewise remain client-side when live proof generation is enabled.

The current public protocol is gated. The bot prepares and authenticates shield/send/swap/withdraw intentions but deliberately does not broadcast deposits or proofs while development proving keys are installed.

Required runtime variables: `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN_FILE`, `ZKTX_SIGNER_URL`, and optionally `ALLOWED_CHAT_IDS`, `ZKTX_BOT_STATE_DIR`, `PORT`.
