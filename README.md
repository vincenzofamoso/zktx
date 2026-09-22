# ZKTX

ZKTX is a standalone privacy-pool project that adapts Zcash-style shielded notes, commitments, nullifiers, Merkle membership, and zero-knowledge authorization to standard ERC-20 tokens on Robinhood Chain, regardless of their launch venue.

Users keep the RH tokens and wallet they already have. ZKTX does not require ZEC, a Zcash wallet, bridging, wrapping, or a pre-swap. The original ERC-20 enters a token-backed vault and its ownership is represented by private notes until withdrawal. ZKTX is an independent EVM implementation inspired by shielded-payment architecture; it is not an Orchard deployment and is not affiliated with the Zcash project.

The current milestone contains:

- A responsive black-and-yellow product interface
- A domain-bound shielded-vault contract with separate deposit, transfer, withdrawal, RFQ-swap, and order-cancellation verifiers
- Circom deposit, transfer, withdrawal, RFQ-swap, and order-cancellation circuits with a Poseidon Merkle tree
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
