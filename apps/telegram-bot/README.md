# ZKTX Telegram bot

Text-first ZKTX workflows with a CURVING-style trusted-device signer. Telegram chat collects action parameters. The Mini App is limited to wallet import/unlock and cryptographic authorization.

The private key is encrypted in the browser with AES-256-GCM and a 600,000-round PBKDF2-SHA256 key. The server stores only the encrypted envelope. A non-exportable decryption key is retained in IndexedDB on the trusted device. Private-note secrets must likewise remain client-side when live proof generation is enabled.

The bot prepares and authenticates shield, private-send, sliced RH market-trade, and withdrawal intentions. Market trades use normal human token amounts, a user-defined minimum net output and deadline, and then hand the reviewed action to the web proof flow. The bot reports live vault, relayer, and keeper readiness rather than claiming an unavailable action executed.

Market trades use compatible existing public RH liquidity in 3 to 7 variable slices. PONS curves and Uniswap pools are execution routes, not the protocol identity. The public sees vault execution rather than the originating wallet, and actual proceeds settle into private notes. The 1.5% fee reserves 0.5% for execution and uses 1% for an atomic ZKTX buyback and burn. Public AMM swaps remain observable.

Required runtime variables: `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN_FILE`, `ZKTX_SIGNER_URL`, and optionally `ALLOWED_CHAT_IDS`, `ZKTX_BOT_STATE_DIR`, `PORT`.
