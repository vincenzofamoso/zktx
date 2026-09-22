# Production deployment gate

`deploy-vault.sh` refuses to broadcast unless all verifier contracts exist on Robinhood Chain, the RPC reports chain ID 4663, and the explicit audit confirmation is present.

Before running it:

1. Run a multi-party Groth16 phase-2 ceremony for each pinned circuit build.
2. Generate and independently verify the Solidity verifiers.
3. Complete circuit, contract, client, relayer, and operational audits.
4. Use a multisig as `ZKTX_OWNER`.
5. Fund a dedicated relayer separately and apply production rate controls.
6. Deploy the vault, allow only reviewed token contracts, and test with capped limits before removing the pause.

The pilot owner address and selected operating model are recorded in `pilot-config.json`. Its encrypted keystore is intentionally stored outside this repository on the deployment server.

Never reuse development proving keys in production.

## Telegram bot

Build the trusted-device signer with `npm run build:telegram`, install `zktx-telegram-bot.service`, and place a dedicated BotFather token at `/etc/zktx/telegram-bot-token` with root-only permissions. The `/telegram-api/` Nginx route proxies authenticated Mini App requests to port 3480. Do not reuse another project's bot token.
