# Robinhood Chain shielded pool

This module accepts standard ERC-20 tokens launched through PONS and represents deposited balances as private notes. The original token remains public outside the vault.

## Privacy boundary

- Deposits disclose the wallet, asset, amount, commitment, and time.
- Private state transitions disclose roots, nullifiers, and commitment counts.
- Withdrawals disclose the destination, asset, amount, nullifier, and time.
- Transfers between shielded notes do not disclose owners or values when the circuit, relayer, and client are used correctly.
- Any execution against the public PONS pool remains visible as an aggregate vault trade.

The current circuits implement shield, private transfer with change, and withdrawal. Private swap is represented in the interface as the next protocol phase. A production swap needs a separately audited two-asset conservation circuit and a batch auction or matching engine. It must not be described as live until those components are deployed.

## Implemented and tested

- Notes bind chain ID, vault address, asset, amount, owner key, and blinding.
- Nullifiers bind the note, owner secret, chain ID, and vault.
- Deposits prove that the public asset and deposited amount match the new private note.
- Transfers prove membership, ownership, nullifier correctness, value conservation, and two append-only outputs.
- Withdrawals prove membership and bind the public asset, recipient, amount, chain, and vault.
- The Solidity vault enforces supported assets, reserves, replay protection, pause control, and proof verification.
- The browser preview encrypts notes locally with PBKDF2 and AES-256-GCM.
- The optional backend indexes vault events and simulates every relayed transaction before signing.

## Still required for production

1. A multi-party phase-2 ceremony and verifiers generated from the final circuit hashes.
2. Independent circuit, contract, client, relayer, and operational audits.
3. Viewing keys and a documented selective-disclosure flow.
4. A production private-swap circuit and batch matching design.
5. A multisig owner, supported-token policy, incident runbook, monitoring, and capped rollout.
6. A funded relayer fleet with abuse controls and a privacy-preserving fee policy.

Never deploy `RhShieldedVault.sol` with mock or development verifiers.
