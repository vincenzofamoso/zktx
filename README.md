# ZKTX

ZKTX is a standalone Robinhood Chain privacy-pool project for standard ERC-20 tokens launched through PONS.

The current milestone contains:

- A responsive black-and-yellow product interface
- A shielded-vault contract scaffold
- A verifier interface for future zero-knowledge circuits
- An explicit privacy-boundary specification
- The Nginx route served at `https://zktx.tech/`

## Current safety state

The interface is a protocol preview. Fund-moving actions remain disabled. `RhShieldedVault.sol` must not be deployed until the note format, circuits, generated verifier, client wallet, relayer, and audits are complete.

## Compile the scaffold

```sh
npx --yes solc@0.8.24 --base-path . --include-path . --abi --bin contracts/RhShieldedVault.sol -o build
```

See `docs/RH_SHIELDED_POOL.md` for the privacy model and remaining production components.
