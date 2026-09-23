#!/usr/bin/env bash
set -euo pipefail

if [[ "${PROTOCOL_MODE:-preview}" == "live" ]]; then
  echo "Refusing to create development keys in live mode." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
output="$root/build/dev-keys"
mkdir -p "$output" "$root/contracts/generated"
exec 9>"$output/setup.lock"
if ! flock -n 9; then
  echo "Development key setup is already running." >&2
  exit 1
fi

if [[ ! -f "$output/pot17_final.ptau" ]]; then
  phase_one_entropy="$(openssl rand -hex 64)"
  npx snarkjs powersoftau new bn128 17 "$output/pot17_0000.ptau"
  npx snarkjs powersoftau contribute "$output/pot17_0000.ptau" "$output/pot17_0001.ptau" \
    --name="ZKTX development phase 1" -e="$phase_one_entropy"
  unset phase_one_entropy
  npx snarkjs powersoftau prepare phase2 "$output/pot17_0001.ptau" "$output/pot17_final.ptau.tmp"
  mv "$output/pot17_final.ptau.tmp" "$output/pot17_final.ptau"
fi

for circuit in deposit transfer withdraw swap cancel-order market-order market-settlement; do
  case "$circuit" in
    cancel-order) verifier_name="CancelOrderVerifier" ;;
    market-order) verifier_name="MarketOrderVerifier" ;;
    market-settlement) verifier_name="MarketSettlementVerifier" ;;
    *) verifier_name="${circuit^}Verifier" ;;
  esac
  entropy="$(openssl rand -hex 64)"
  npx snarkjs groth16 setup "$root/build/circuits/$circuit.r1cs" "$output/pot17_final.ptau" "$output/${circuit}_0000.zkey.tmp"
  npx snarkjs zkey contribute "$output/${circuit}_0000.zkey.tmp" "$output/${circuit}_final.zkey.tmp" --name="ZKTX ${circuit} development" -e="$entropy"
  mv "$output/${circuit}_0000.zkey.tmp" "$output/${circuit}_0000.zkey"
  mv "$output/${circuit}_final.zkey.tmp" "$output/${circuit}_final.zkey"
  unset entropy
  npx snarkjs zkey export verificationkey "$output/${circuit}_final.zkey" "$output/${circuit}_verification_key.json"
  npx snarkjs zkey export solidityverifier "$output/${circuit}_final.zkey" "$root/contracts/generated/${verifier_name}.sol"
  sed -i "s/contract Groth16Verifier/contract ${verifier_name}/" "$root/contracts/generated/${verifier_name}.sol"
  if [[ "$circuit" == "deposit" || "$circuit" == "market-order" || "$circuit" == "market-settlement" ]]; then
    mkdir -p "$root/public/proving"
    cp "$root/build/circuits/${circuit}_js/${circuit}.wasm" "$root/public/proving/${circuit}.wasm"
    cp "$output/${circuit}_final.zkey" "$root/public/proving/${circuit}_final.zkey"
  fi
done

echo "Development keys generated. They are ignored by git and MUST NOT secure real funds."
