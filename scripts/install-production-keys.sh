#!/usr/bin/env bash
set -euo pipefail

: "${PRODUCTION_ZKEY_DIR:?PRODUCTION_ZKEY_DIR must contain the final ceremony .zkey files}"
: "${PHASE1_PTAU:?PHASE1_PTAU must point to the verified phase-1 powers-of-tau file}"

root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="$root/build/production-key-sha256.txt"
mkdir -p "$root/build" "$root/contracts/generated" "$root/public/proving"
: > "$manifest"

for circuit in deposit transfer withdraw swap cancel-order market-order market-settlement; do
  zkey="$PRODUCTION_ZKEY_DIR/${circuit}_final.zkey"
  if [[ ! -f "$zkey" ]]; then
    echo "Missing final ceremony artifact: $zkey" >&2
    exit 1
  fi
  npx snarkjs zkey verify "$root/build/circuits/$circuit.r1cs" "$PHASE1_PTAU" "$zkey"
  npx snarkjs zkey export verificationkey "$zkey" "$root/build/${circuit}_verification_key.json"
  case "$circuit" in
    cancel-order) verifier_name="CancelOrderVerifier" ;;
    market-order) verifier_name="MarketOrderVerifier" ;;
    market-settlement) verifier_name="MarketSettlementVerifier" ;;
    *) verifier_name="${circuit^}Verifier" ;;
  esac
  npx snarkjs zkey export solidityverifier "$zkey" "$root/contracts/generated/${verifier_name}.sol"
  sed -i "s/contract Groth16Verifier/contract ${verifier_name}/" "$root/contracts/generated/${verifier_name}.sol"
  shasum -a 256 "$root/build/circuits/$circuit.r1cs" "$zkey" \
    "$root/build/${circuit}_verification_key.json" "$root/contracts/generated/${verifier_name}.sol" >> "$manifest"
  if [[ "$circuit" == "deposit" || "$circuit" == "market-order" || "$circuit" == "market-settlement" ]]; then
    cp "$root/build/circuits/${circuit}_js/${circuit}.wasm" "$root/public/proving/${circuit}.wasm"
    cp "$zkey" "$root/public/proving/${circuit}_final.zkey"
  fi
done

echo "Verified and installed final proving artifacts. Publish and independently verify $manifest."
