#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_UNAUDITED_DEPLOY:-}" != "I_ACCEPT_UNAUDITED_RISK" ]]; then
  echo "Refusing deployment: set CONFIRM_UNAUDITED_DEPLOY=I_ACCEPT_UNAUDITED_RISK." >&2
  exit 1
fi

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${ROUTER_OWNER:?ROUTER_OWNER is required}"
: "${ROUTE_DELAY_SECONDS:=86400}"

if ! [[ "$ROUTER_OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ROUTER_OWNER must be an EVM address." >&2
  exit 1
fi
if ! [[ "$ROUTE_DELAY_SECONDS" =~ ^[0-9]+$ ]] || (( ROUTE_DELAY_SECONDS < 3600 )); then
  echo "ROUTE_DELAY_SECONDS must be at least 3600; 86400 is recommended." >&2
  exit 1
fi

forge create contracts/RhRoutingSwapAdapter.sol:RhRoutingSwapAdapter \
  --rpc-url "$RH_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$ROUTER_OWNER" "$ROUTE_DELAY_SECONDS"

