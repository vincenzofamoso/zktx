#!/usr/bin/env bash
set -euo pipefail

: "${RH_RPC_URL:?RH_RPC_URL is required}"
: "${ROUTER_OWNER_PRIVATE_KEY:?ROUTER_OWNER_PRIVATE_KEY is required}"
: "${ROUTING_ADAPTER:?ROUTING_ADAPTER is required}"
: "${TOKEN_IN:?TOKEN_IN is required}"
: "${TOKEN_OUT:?TOKEN_OUT is required}"
: "${VENUE_ADAPTER:?VENUE_ADAPTER is required}"

for address in "$ROUTING_ADAPTER" "$TOKEN_IN" "$TOKEN_OUT" "$VENUE_ADAPTER"; do
  if ! [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Invalid address: $address" >&2
    exit 1
  fi
done
if [[ "$TOKEN_IN" == "$TOKEN_OUT" || "$ROUTING_ADAPTER" == "$VENUE_ADAPTER" ]]; then
  echo "Invalid route configuration." >&2
  exit 1
fi
if [[ "$(cast code "$ROUTING_ADAPTER" --rpc-url "$RH_RPC_URL")" == "0x" || "$(cast code "$VENUE_ADAPTER" --rpc-url "$RH_RPC_URL")" == "0x" ]]; then
  echo "Routing and venue adapters must have deployed bytecode." >&2
  exit 1
fi

cast send "$ROUTING_ADAPTER" \
  "proposeRoute(address,address,address)" "$TOKEN_IN" "$TOKEN_OUT" "$VENUE_ADAPTER" \
  --rpc-url "$RH_RPC_URL" --private-key "$ROUTER_OWNER_PRIVATE_KEY"

route_key="$(cast call "$ROUTING_ADAPTER" "routeKey(address,address)(bytes32)" "$TOKEN_IN" "$TOKEN_OUT" --rpc-url "$RH_RPC_URL")"
pending="$(cast call "$ROUTING_ADAPTER" "pendingRoutes(bytes32)(address,uint64)" "$route_key" --rpc-url "$RH_RPC_URL")"
echo "Route proposed. Activate it after the configured delay with:"
echo "cast send $ROUTING_ADAPTER 'activateRoute(address,address)' $TOKEN_IN $TOKEN_OUT --rpc-url \"\$RH_RPC_URL\" --private-key \"\$ROUTER_OWNER_PRIVATE_KEY\""
echo "Pending route: $pending"
