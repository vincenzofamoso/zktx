#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_UNAUDITED_DEPLOY:-}" != "I_ACCEPT_UNAUDITED_RISK" ]]; then
  echo "Refusing adapter deployment: this integration is unaudited. Set CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK to continue." >&2
  exit 1
fi

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${PONS_V3_ROUTER:?PONS_V3_ROUTER is required}"
: "${PONS_WETH:?PONS_WETH is required}"

chain_id="$(cast chain-id --rpc-url "$RH_RPC_URL")"
if [[ "$chain_id" != "4663" ]]; then
  echo "Refusing deployment on chain $chain_id; expected Robinhood Chain 4663." >&2
  exit 1
fi

for contract in "$PONS_V3_ROUTER" "$PONS_WETH"; do
  code="$(cast code "$contract" --rpc-url "$RH_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "Refusing deployment: $contract has no bytecode." >&2
    exit 1
  fi
done

forge create contracts/PonsV3SwapAdapter.sol:PonsV3SwapAdapter \
  --rpc-url "$RH_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$PONS_V3_ROUTER" "$PONS_WETH" 10000
