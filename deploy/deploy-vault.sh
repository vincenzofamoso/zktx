#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_PRODUCTION_DEPLOY:-}" != "I_HAVE_AUDITED_ZKTX" ]]; then
  echo "Refusing deployment: set CONFIRM_PRODUCTION_DEPLOY=I_HAVE_AUDITED_ZKTX after an independent audit." >&2
  exit 1
fi

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${ZKTX_OWNER:?ZKTX_OWNER is required}"
: "${DEPOSIT_VERIFIER:?DEPOSIT_VERIFIER is required}"
: "${TRANSFER_VERIFIER:?TRANSFER_VERIFIER is required}"
: "${WITHDRAW_VERIFIER:?WITHDRAW_VERIFIER is required}"
: "${SWAP_VERIFIER:?SWAP_VERIFIER is required}"
: "${CANCEL_ORDER_VERIFIER:?CANCEL_ORDER_VERIFIER is required}"
: "${GENESIS_ROOT:?GENESIS_ROOT is required}"

chain_id="$(cast chain-id --rpc-url "$RH_RPC_URL")"
if [[ "$chain_id" != "4663" ]]; then
  echo "Refusing deployment on chain $chain_id; expected Robinhood Chain 4663." >&2
  exit 1
fi

for verifier in "$DEPOSIT_VERIFIER" "$TRANSFER_VERIFIER" "$WITHDRAW_VERIFIER" "$SWAP_VERIFIER" "$CANCEL_ORDER_VERIFIER"; do
  code="$(cast code "$verifier" --rpc-url "$RH_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "Refusing deployment: verifier $verifier has no bytecode." >&2
    exit 1
  fi
done

forge create contracts/RhShieldedVault.sol:RhShieldedVault \
  --rpc-url "$RH_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$ZKTX_OWNER" "$DEPOSIT_VERIFIER" "$TRANSFER_VERIFIER" "$WITHDRAW_VERIFIER" "$SWAP_VERIFIER" "$CANCEL_ORDER_VERIFIER" "$GENESIS_ROOT"
