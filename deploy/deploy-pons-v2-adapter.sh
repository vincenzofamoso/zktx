#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_UNAUDITED_DEPLOY:-}" != "I_ACCEPT_UNAUDITED_RISK" ]]; then
  echo "Refusing adapter deployment: this integration is unaudited. Set CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK to continue." >&2
  exit 1
fi

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${PONS_V2_FACTORY:=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e}"
: "${PONS_WRAPPED_NATIVE:=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73}"
: "${PONS_QUOTE_ASSET:=$PONS_WRAPPED_NATIVE}"

chain_id="$(cast chain-id --rpc-url "$RH_RPC_URL")"
if [[ "$chain_id" != "4663" ]]; then
  echo "Refusing deployment on chain $chain_id; expected Robinhood Chain 4663." >&2
  exit 1
fi

for contract in "$PONS_V2_FACTORY" "$PONS_QUOTE_ASSET" "$PONS_WRAPPED_NATIVE"; do
  code="$(cast code "$contract" --rpc-url "$RH_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "Refusing deployment: $contract has no bytecode." >&2
    exit 1
  fi
done

pool_manager="$(cast call "$PONS_V2_FACTORY" "poolManager()(address)" --rpc-url "$RH_RPC_URL")"
meme_hook="$(cast call "$PONS_V2_FACTORY" "memeHook()(address)" --rpc-url "$RH_RPC_URL")"
for dependency in "$pool_manager" "$meme_hook"; do
  code="$(cast code "$dependency" --rpc-url "$RH_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "Refusing deployment: PONS V2 dependency $dependency has no bytecode." >&2
    exit 1
  fi
done

forge create contracts/PonsV2SwapAdapter.sol:PonsV2SwapAdapter \
  --rpc-url "$RH_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$PONS_V2_FACTORY" "$PONS_QUOTE_ASSET" "$PONS_WRAPPED_NATIVE"
