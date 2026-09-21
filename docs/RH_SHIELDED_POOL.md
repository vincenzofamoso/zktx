# Robinhood Chain shielded pool

This module accepts standard ERC-20 tokens launched through PONS and represents deposited balances as private notes. The original token remains public outside the vault.

## Privacy boundary

- Deposits disclose the wallet, asset, amount, commitment, and time.
- Private state transitions disclose roots, nullifiers, and commitment counts.
- Withdrawals disclose the destination, asset, amount, nullifier, and time.
- Transfers and swaps between shielded notes do not disclose their owners or values when the circuit, relayer, and client are implemented correctly.
- Any execution against the public PONS pool remains visible as an aggregate vault trade.

## Required production components

1. A reviewed note format with asset identifiers, amounts, ownership keys, randomness, and domain separation.
2. Merkle inclusion, balance conservation, nullifier derivation, and output commitment circuits.
3. A verifier generated from the pinned circuit build.
4. A local encrypted note wallet and scanning service.
5. Relayers with fee notes so users do not reveal a gas wallet.
6. Batched public-market execution to reduce amount and timing correlation.
7. Viewing keys and a documented disclosure flow.
8. Independent circuit and contract audits before accepting funds.

`RhShieldedVault.sol` is an integration scaffold. It must not be deployed with a mock verifier.
