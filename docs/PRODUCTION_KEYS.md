# Final Groth16 keys

PONS does not issue ZKTX proving keys. They are generated from the exact frozen ZKTX circuit builds. The proving `.zkey`, verification-key JSON, circuit/WASM, generated Solidity verifier, hashes, and ceremony transcript are public artifacts. Only discarded contribution entropy must remain unavailable.

## Ceremony outline

1. Freeze the repository commit and run `npm run circuits:compile` in a reproducible environment.
2. Obtain a sufficiently large, independently verified BN254 powers-of-tau phase-1 transcript. The current circuits use pot17 in development; confirm the final constraint counts before choosing the production size.
3. Run `snarkjs groth16 setup` separately for every circuit R1CS.
4. Have multiple independent contributors run `snarkjs zkey contribute` for every circuit, publish each intermediate hash, and destroy their entropy.
5. Apply a publicly announced random beacon with `snarkjs zkey beacon`.
6. Run `snarkjs zkey verify` against the frozen R1CS and verified phase-1 transcript, then independently reproduce the verification key and Solidity verifier.
7. Put the final files in one directory as `<circuit>_final.zkey`, then install only verified artifacts:

```sh
PRODUCTION_ZKEY_DIR=/absolute/path/to/final-zkeys \
PHASE1_PTAU=/absolute/path/to/verified-phase1.ptau \
npm run keys:production:install
```

The installer verifies each final key, exports its verification key and Solidity verifier, copies the three browser proving artifacts (`deposit`, `market-order`, and `market-settlement`), and writes `build/production-key-sha256.txt`.

Never rename development artifacts as production keys. A single-party development setup leaves one operator able to retain the toxic waste and forge proofs.
