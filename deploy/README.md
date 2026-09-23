# Production deployment gate

`deploy-vault.sh` refuses to broadcast unless all verifier contracts exist on Robinhood Chain, the RPC reports chain ID 4663, and `CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK` is present. This acknowledgement records that the requested launch is skipping audits; it is not an audit claim.

Before running it:

1. Run a multi-party Groth16 phase-2 ceremony for each pinned circuit build.
2. Generate and independently verify the Solidity verifiers.
3. Use a multisig as `ZKTX_OWNER`.
4. Fund dedicated relayer and keeper accounts and apply production rate controls.
5. Deploy the vault, allow only reviewed token contracts, and test with capped limits before removing the pause.
6. Deploy venue adapters for the RH routes being enabled. `PonsV2SwapAdapter` supports V2 curves and graduated V4 pools; `PonsV3SwapAdapter` supports V1 Uniswap V3 pools.
7. Deploy `RhRoutingSwapAdapter` with `deploy-routing-adapter.sh`, using a reviewed owner and a recommended 24-hour route delay. Propose each direction-specific pair with `configure-routing-adapter.sh`; activate it only after verifying the adapter, tokens, pool, fee tier, quote asset, and canary simulations. Reverse directions are separate routes.
8. Generate the final market-order and market-settlement verifiers, then run `configure-market.sh` with the routing adapter as `PONS_SWAP_ADAPTER` (the legacy variable name remains for compatibility).
9. Authorize the dedicated keeper and cap its native-gas balance.

The one-time market configuration fixes the two new verifier addresses, swap adapter, WETH quote asset, ZKTX token, and execution-fee recipient. Replacing any of them requires a new vault and migration plan.

The official PONS repository lists the Robinhood Chain V2 factory as `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`. On 2026-09-22 its live getters returned PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951` and meme hook `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`; all three addresses had bytecode. `deploy-pons-v2-adapter.sh` reads and checks the dependencies again at deployment rather than trusting these recorded values. Its native-launch defaults use the live WETH contract `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, whose code and `WETH` symbol were rechecked on the same date. Override `PONS_QUOTE_ASSET` for a PONS V2 launch using an ERC-20 pair token.

The market fee is hard-coded at 150 basis points: 50 basis points remain as quote-asset execution reserves and 100 basis points immediately buy and burn ZKTX during every slice. The vault checks that the burn reduces `totalSupply()`; genuine PONS V2 launcher tokens inherit `ERC20Burnable`.

The pilot owner address and selected operating model are recorded in `pilot-config.json`. Its encrypted keystore is intentionally stored outside this repository on the deployment server.

Never reuse development proving keys in production.

## Telegram bot

Build the trusted-device signer with `npm run build:telegram`, install `zktx-telegram-bot.service`, and place a dedicated BotFather token at `/etc/zktx/telegram-bot-token` with root-only permissions. The `/telegram-api/` Nginx route proxies authenticated Mini App requests to port 3540. Do not reuse another project's bot token.
