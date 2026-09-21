# ZKTX

ZKTX is a standalone Robinhood Chain privacy-pool project for standard ERC-20 tokens launched through PONS.

The current milestone contains:

- A responsive black-and-yellow product interface
- A domain-bound shielded-vault contract with separate deposit, transfer, and withdrawal verifiers
- Circom deposit, transfer, and withdrawal circuits with a Poseidon Merkle tree
- A local AES-GCM encrypted note wallet preview
- A persistent event indexer and guarded, simulation-first relayer
- A Robinhood Chain-only deployment gate
- An explicit privacy-boundary specification
- The Nginx route served at `https://zktx.tech/`

## Current safety state

The interface remains a protocol preview and fund-moving actions remain disabled. The circuits and vault now have executable tests, but production verifier keys, an independent audit, a multisig owner, the final supported token list, and a funded relayer are still required.

## Validate the protocol

```sh
npm install
npm test
```

Run the preview backend with `npm start`. It binds to localhost and defaults to `PROTOCOL_MODE=preview`. See `.env.example`, `docs/RH_SHIELDED_POOL.md`, and `deploy/README.md`.
