#!/usr/bin/env bash
# Runs MineChain's Fuji validator node (AvalancheGo + Subnet-EVM plugin) inside WSL/Linux.
# Partial sync: the node only syncs the P-Chain of the Primary Network, which is all an
# Etna-style L1 validator needs.
#   ./l1/fuji-node.sh                 # before the L1 exists
#   ./l1/fuji-node.sh <subnetID>      # once created, so the node tracks and validates MineChain
set -euo pipefail
ROOT="${MINECHAIN_FUJI_HOME:-$HOME/minechain-fuji}"
SUBNET_ID="${1:-}"

args=(
  --network-id=fuji
  --partial-sync-primary-network
  --data-dir="$ROOT/data"
  --plugin-dir="$ROOT/plugins"
  --chain-config-dir="$ROOT/chain-configs"
  --http-host=127.0.0.1
  --http-port=9650
  --staking-port=9651
  # UDP DNS to OpenDNS doesn't leave WSL's NAT; the HTTP-based lookup does.
  --public-ip-resolution-service=ifconfigCo
  --log-level=info
)
[ -n "$SUBNET_ID" ] && args+=(--track-subnets="$SUBNET_ID")

mkdir -p "$ROOT/chain-configs"
exec "$ROOT/bin/avalanchego" "${args[@]}"
