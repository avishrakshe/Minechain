#!/usr/bin/env bash
# Starts (or restarts) the Fuji node in the background on every codespace start.
# Once MineChain exists, its Subnet ID is stored in ~/minechain-fuji/subnet-id so the node tracks it.
set -uo pipefail
ROOT="$HOME/minechain-fuji"
[ -x "$ROOT/bin/avalanchego" ] || { echo "run .devcontainer/setup.sh first"; exit 0; }
pkill -f "$ROOT/bin/avalanchego" 2>/dev/null && sleep 3
SUBNET_ID=$(cat "$ROOT/subnet-id" 2>/dev/null || true)
export MINECHAIN_IP_SERVICE="${MINECHAIN_IP_SERVICE:-opendns}"   # ifconfig.co challenges codespace IPs
export MINECHAIN_PUBLIC_IP="${MINECHAIN_PUBLIC_IP:-127.0.0.1}"   # codespaces accept no inbound P2P
nohup bash "$(dirname "$0")/../l1/fuji-node.sh" $SUBNET_ID > "$ROOT/node.log" 2>&1 &
echo "Fuji node starting (subnet: ${SUBNET_ID:-none yet}); log: $ROOT/node.log"
