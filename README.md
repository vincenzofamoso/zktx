# ZKTX

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ZKTX is a standalone privacy-pool project that adapts Zcash-style shielded notes, commitments, nullifiers, Merkle membership, and zero-knowledge authorization to standard ERC-20 tokens on Robinhood Chain, regardless of their launch venue.

Users keep the RH tokens and wallet they already have. ZKTX does not require ZEC, a Zcash wallet, bridging, wrapping, or a pre-swap. The original ERC-20 enters a token-backed vault and its ownership is represented by private notes until withdrawal. ZKTX is an independent EVM implementation inspired by shielded-payment architecture; it is not an Orchard deployment and is not affiliated with the Zcash project.

The complete protocol, circuits, contracts, web client, relayer, keeper, indexer, deployment scripts, and Telegram client are available in this repository under the MIT License. Runtime secrets, operator keys, and user wallet material are intentionally excluded.

The current milestone contains:

- A responsive black-and-yellow product interface
- A domain-bound shielded-vault contract with separate deposit, transfer, withdrawal, RFQ-swap, order-cancellation, market-order, and market-settlement verifiers
- Circom deposit, transfer, withdrawal, RFQ-swap, order-cancellation, market-order, and market-settlement circuits with a Poseidon Merkle tree
- Shielded public-market intents with 3 to 7 execution slices, one slice per block, and private settlement notes
- A fixed 1.5% market fee: 0.5% execution reserve plus an atomic 1% ZKTX buyback and native token burn
- An adapter-based RH execution layer, currently including PONS V2 bonding curves, graduated Uniswap V4 pools, PONS V1 Uniswap V3 pools, and wrapped/native conversion
- Browser proof flows for opening a relayed market order and settling actual proceeds into private notes
- A local AES-GCM encrypted note wallet preview
- A persistent event indexer and guarded, simulation-first relayer
- A Robinhood Chain-only deployment gate
- A text-first Telegram bot with CURVING-style trusted-device wallet encryption and signing
- An explicit privacy-boundary specification
- The Nginx route served at `https://zktx.tech/`

## Current safety state

The market flow is implemented but remains disabled until the final Groth16 artifacts, verifier and vault addresses, supported assets, approved RH execution adapter, keeper, and relayer are configured. The project is explicitly unaudited. The deployment scripts require `CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK` so skipping review cannot be mistaken for review having occurred.

## Validate the protocol

```sh
npm install
npm test
```

Run the preview backend with `npm start`. It binds to localhost and defaults to `PROTOCOL_MODE=preview`. See `.env.example`, `docs/RH_SHIELDED_POOL.md`, and `deploy/README.md`.

The Telegram workflow is documented in `apps/telegram-bot/README.md`. Build its minimal trusted-device signer with `npm run build:telegram`. Its public actions remain gated by the same production-key and deployment requirements as the web app.
