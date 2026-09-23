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
- Any execution against a public RH pool remains visible as a vault trade. Slicing obscures the original order shape but does not make public AMM reserve changes invisible.

The current circuits implement shielding, private transfers with change, withdrawals, two-asset RFQ settlement, maker-only order cancellation, shielded public-market order authorization, and private public-market settlement. The browser can build, relay, persist, and later settle a public-market order once the production contracts, keys, relayer, and keeper are configured.

## Implemented and tested

- Notes bind chain ID, vault address, asset, amount, owner key, and blinding.
- Nullifiers bind the note, owner secret, chain ID, and vault.
- Deposits prove that the public asset and deposited amount match the new private note.
- Transfers prove membership, ownership, nullifier correctness, value conservation, and two append-only outputs.
- Withdrawals prove membership and bind the public asset, recipient, amount, chain, and vault.
- RFQ swaps consume maker and taker notes atomically, enforce exact committed order terms and deadlines, create private outputs for both parties, and return private taker change.
- Order cancellation requires the maker's separate cancellation secret and races safely against settlement through the same order nullifier.
- Public-market orders consume a private input note, execute in a protocol-selected 3–7 slices with at most one slice per block, and settle actual proceeds plus any unspent refund into private notes after a 30-second delay.
- The market fee is fixed at 150 basis points. Fifty basis points accrue in the configured quote asset as an execution reserve and 100 basis points buy ZKTX atomically during every slice and call its native `burn(uint256)` function.
- Fee arithmetic is cumulative across slices, so it matches the normal whole-order basis-point calculation instead of rounding down independently on every slice.
- The Solidity vault enforces supported assets, reserves, replay protection, pause control, and proof verification.
- The browser encrypts notes and pending settlement secrets locally with PBKDF2 and AES-256-GCM.
- The optional backend indexes vault events and simulates every relayed transaction before signing.

## Release inputs still required

1. A multi-party phase-2 ceremony and verifiers generated from the final circuit hashes.
2. Production proving keys and Solidity verifiers generated from the frozen market-order and market-settlement circuits.
3. Final quote asset, wrapped-native, approved execution adapter, ZKTX token, vault, keeper, and fee-recipient addresses.
4. A multisig owner, supported-token policy, incident runbook, monitoring, and capped rollout.
5. A funded relayer and keeper with abuse controls and native gas.

The requested launch explicitly skips independent audits. That removes a release gate; it does not make the contracts, circuits, browser prover, relayer, or keeper safe. All interfaces and deployment instructions must continue to label the system unaudited.

## Mainnet pilot configuration

- Robinhood Chain ID: `4663`
- Vault owner: an encrypted, server-held operator wallet until control is moved to a multisig
- Gas: platform-funded relayer with simulation and request limits
- Asset rollout: one token at a time, with an immutable-on-transaction owner-set reserve cap
- Swap support: shielded two-party RFQ settlement plus sliced adapter-based RH market execution behind separate deployment gates

RFQ settlement does not require either trader to reveal a spend secret. A maker note commits exact terms and a separate cancellation public key; settlement creates predetermined private outputs, while only the maker can prove the cancellation secret.

## Sliced RH market execution

A market-order proof binds the private input note to its public pair, input amount, minimum net output, deadline, and a private settlement key. The vault removes the input backing from spendable private reserves and places it in market escrow. An authorized keeper executes a protocol-sized slice no more than once per block. Slice sizes derive from recent block data and are operational obfuscation, not cryptographic randomness.

For quote-funded buys, the vault takes both fees from quote input before executing the user portion. For token sales, it takes both fees from realized quote output. Each slice immediately routes the 1% buyback allocation through the configured adapter, receives ZKTX, calls `burn(uint256)`, and verifies equal vault-balance and total-supply reductions. If either trade, the protected buyback minimum, or the burn check fails, the entire slice reverts atomically.

After every slice completes, settlement becomes available after 30 seconds. A partially executed order can settle after its deadline plus 30 seconds. The settlement proof appends a private output note and a private refund note; either may have zero value. The user receives actual net proceeds, so the protocol takes no market-maker inventory risk.

Execution is adapter-based rather than PONS-exclusive. PONS V1 launches use WETH-quoted Uniswap V3 pools, and `PonsV3SwapAdapter.sol` supports that route with a configurable router and fee tier. `PonsV2SwapAdapter.sol` reads the official V2 factory launch record, trades against the per-token bonding curve before graduation, permissionlessly completes a swept graduation when needed, and trades the factory-defined Uniswap V4 pool afterward. If a final curve buy partially fills, the adapter sends its refund through the newly created V4 pool in the same atomic slice. Native-ETH launches are normalized to wrapped native at the vault boundary. Other RH venues can be added through reviewed `ISwapAdapter` implementations. The current vault fixes one adapter and quote asset at configuration time; broader venue selection requires a reviewed routing adapter or separate vault deployment.

PONS V2 launcher tokens inherit OpenZeppelin `ERC20Burnable`, so genuine V2 ZKTX tokens support a real supply-reducing burn. Configuration with a non-burnable token fails during the first buyback slice.

The public can still observe and cluster the vault's slice swaps and immediate buybacks. With one active order, timing and amounts may reveal the aggregate order even though its note owner remains hidden. Multiple overlapping orders and internal RFQ matching provide a stronger anonymity set.

Skipping an audit is separate from skipping the Groth16 ceremony. Development proving keys can demonstrate the full proving and verification path, but they are not acceptable for public funds because one setup operator may retain toxic waste. Final keys come from the frozen circuits: use a verified phase-1 powers-of-tau file, run a multi-party phase-2 contribution for each circuit, apply a public beacon, verify every transcript, and publish the `.zkey`, verification key, circuit hashes, and generated verifier source. PONS does not provide these keys.

Never deploy `RhShieldedVault.sol` with mock or development verifiers.
