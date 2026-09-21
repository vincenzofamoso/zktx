# Production deployment gate

`deploy-vault.sh` refuses to broadcast unless all verifier contracts exist on Robinhood Chain, the RPC reports chain ID 4663, and the explicit audit confirmation is present.

Before running it:

1. Run a multi-party Groth16 phase-2 ceremony for each pinned circuit build.
2. Generate and independently verify the Solidity verifiers.
3. Complete circuit, contract, client, relayer, and operational audits.
4. Use a multisig as `ZKTX_OWNER`.
5. Fund a dedicated relayer separately and apply production rate controls.
6. Deploy the vault, allow only reviewed token contracts, and test with capped limits before removing the pause.

Never reuse development proving keys in production.
