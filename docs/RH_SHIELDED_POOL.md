# Robinhood Chain shielded pool

This module accepts supported standard ERC-20 tokens on Robinhood Chain, regardless of their launch venue, and represents deposited balances as Zcash-style private notes. The original token remains public outside the vault.

## Zcash-style architecture without ZEC

ZKTX borrows the privacy pattern rather than the ZEC asset. A note represents a secret claim on ERC-20 reserves; its commitment enters a Merkle tree; a one-time nullifier prevents double-spending; and a zero-knowledge proof authorizes each private state transition. A relayer can broadcast valid proofs so the note owner is not exposed as the gas payer.

The implementation is native to Robinhood Chain and EVM verification. It does not run Orchard, bridge ZEC, or require a second wallet. Users connect an RH wallet, shield the RH token they already own, transact as private notes, and later withdraw the original RH asset. ZKTX is independent and is not affiliated with the Zcash project.

## Privacy boundary

- Deposits disclose the wallet, asset, amount, commitment, and time.
- Private state transitions disclose roots, nullifiers, and commitment counts.
- Withdrawals disclose the destination, asset, amount, nullifier, and time.
- Transfers between shielded notes do not disclose owners or values when the circuit, relayer, and client are used correctly.
- Any execution against the public PONS pool remains visible as an aggregate vault trade.

The current circuits implement shielding, private transfers with change, withdrawals, two-asset RFQ settlement, and maker-only order cancellation. The RFQ path is implemented and tested as a prototype but is not production-enabled. Public-market batching is a separate future component.

## Implemented and tested

- Notes bind chain ID, vault address, asset, amount, owner key, and blinding.
- Nullifiers bind the note, owner secret, chain ID, and vault.
- Deposits prove that the public asset and deposited amount match the new private note.
- Transfers prove membership, ownership, nullifier correctness, value conservation, and two append-only outputs.
- Withdrawals prove membership and bind the public asset, recipient, amount, chain, and vault.
- RFQ swaps consume maker and taker notes atomically, enforce exact committed order terms and deadlines, create private outputs for both parties, and return private taker change.
- Order cancellation requires the maker's separate cancellation secret and races safely against settlement through the same order nullifier.
- The Solidity vault enforces supported assets, reserves, replay protection, pause control, and proof verification.
- The browser preview encrypts notes locally with PBKDF2 and AES-256-GCM.
- The optional backend indexes vault events and simulates every relayed transaction before signing.

## Still required for production

1. A multi-party phase-2 ceremony and verifiers generated from the final circuit hashes.
2. Independent circuit, contract, client, relayer, and operational audits.
3. Viewing keys and a documented selective-disclosure flow.
4. Production proving keys for the final RFQ circuits and a separately constrained public-market batch design.
5. A multisig owner, supported-token policy, incident runbook, monitoring, and capped rollout.
6. A funded relayer fleet with abuse controls and a privacy-preserving fee policy.

## Mainnet pilot configuration

- Robinhood Chain ID: `4663`
- Vault owner: an encrypted, server-held operator wallet until control is moved to a multisig
- Gas: platform-funded relayer with simulation and request limits
- Asset rollout: one token at a time, with an immutable-on-transaction owner-set reserve cap
- Swap support: shielded two-party RFQ settlement; batched PONS execution remains a separate roadmap item

RFQ settlement does not require either trader to reveal a spend secret. A maker note commits exact terms and a separate cancellation public key; settlement creates predetermined private outputs, while only the maker can prove the cancellation secret. Production activation still requires final proving keys and audits. Batched PONS execution additionally needs a constrained batch circuit, maximum slippage, deadlines, fair allocation, and an audited matcher.

The requested pilot skips a multi-party production ceremony. Development proving keys can demonstrate the full proving and verification path, but they are not acceptable for uncapped public funds because one setup operator may retain toxic waste. This limitation cannot be repaired with application code.

Never deploy `RhShieldedVault.sol` with mock or development verifiers.
