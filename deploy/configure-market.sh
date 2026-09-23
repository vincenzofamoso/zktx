#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_UNAUDITED_DEPLOY:-}" != "I_ACCEPT_UNAUDITED_RISK" ]]; then
  echo "Refusing market configuration: this integration is unaudited. Set CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK to continue." >&2
  exit 1
fi

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${ZKTX_VAULT_ADDRESS:?ZKTX_VAULT_ADDRESS is required}"
: "${MARKET_ORDER_VERIFIER:?MARKET_ORDER_VERIFIER is required}"
: "${MARKET_SETTLEMENT_VERIFIER:?MARKET_SETTLEMENT_VERIFIER is required}"
: "${PONS_SWAP_ADAPTER:?PONS_SWAP_ADAPTER is required}"
: "${PONS_QUOTE_ASSET:=${PONS_WETH:-0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73}}"
: "${ZKTX_TOKEN_ADDRESS:?ZKTX_TOKEN_ADDRESS is required}"
: "${ZKTX_EXECUTION_FEE_RECIPIENT:?ZKTX_EXECUTION_FEE_RECIPIENT is required}"
: "${ZKTX_MARKET_KEEPER:?ZKTX_MARKET_KEEPER is required}"

chain_id="$(cast chain-id --rpc-url "$RH_RPC_URL")"
if [[ "$chain_id" != "4663" ]]; then
  echo "Refusing configuration on chain $chain_id; expected Robinhood Chain 4663." >&2
  exit 1
fi

for contract in "$ZKTX_VAULT_ADDRESS" "$MARKET_ORDER_VERIFIER" "$MARKET_SETTLEMENT_VERIFIER" "$PONS_SWAP_ADAPTER" "$PONS_QUOTE_ASSET" "$ZKTX_TOKEN_ADDRESS"; do
  code="$(cast code "$contract" --rpc-url "$RH_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "Refusing configuration: $contract has no bytecode." >&2
    exit 1
  fi
done

cast send "$ZKTX_VAULT_ADDRESS" \
  "configureMarket(address,address,address,address,address,address)" \
  "$MARKET_ORDER_VERIFIER" "$MARKET_SETTLEMENT_VERIFIER" "$PONS_SWAP_ADAPTER" \
  "$PONS_QUOTE_ASSET" "$ZKTX_TOKEN_ADDRESS" "$ZKTX_EXECUTION_FEE_RECIPIENT" \
  --rpc-url "$RH_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$ZKTX_VAULT_ADDRESS" "setMarketKeeper(address,bool)" "$ZKTX_MARKET_KEEPER" true \
  --rpc-url "$RH_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
