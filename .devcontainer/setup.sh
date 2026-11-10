#!/usr/bin/env bash
# One-time codespace setup. Every binary is a pinned official release artifact whose SHA-256 is checked
# before install: AvalancheGo + Subnet-EVM against GitHub's published asset digests, avalanche-cli against
# its release checksums.txt. No remote scripts are executed.
set -euo pipefail
TAG=v1.15.3
CLI_VER=1.9.7
VM_ID=qBnAJGwKaTSDrrFd6fVH7yAv6nAZxE7vF4Gvi21xLFEKsoSJk   # Subnet-EVM VM ID for the chain name "minechain"
ROOT="$HOME/minechain-fuji"
mkdir -p "$ROOT/bin" "$ROOT/plugins" "$ROOT/dl" "$HOME/bin"
cd "$ROOT/dl"

asset_field() { # $1 = asset name, $2 = field (browser_download_url|digest); reads release JSON on stdin
  node -e "const r=JSON.parse(require('fs').readFileSync(0));const a=r.assets.find(a=>a.name===process.argv[1]);if(!a)process.exit(2);process.stdout.write(String(a[process.argv[2]]||''))" "$1" "$2"
}

rel=$(curl -fsSL "https://api.github.com/repos/ava-labs/avalanchego/releases/tags/$TAG")
for name in "avalanchego-linux-amd64-$TAG.tar.gz" "subnet-evm-linux-amd64-$TAG.tar.gz"; do
  url=$(echo "$rel" | asset_field "$name" browser_download_url)
  digest=$(echo "$rel" | asset_field "$name" digest); digest=${digest#sha256:}
  [ -n "$digest" ] || { echo "no published digest for $name; refusing" >&2; exit 1; }
  curl -fsSL -o "$name" "$url"
  echo "$digest  $name" | sha256sum -c -
done
tar -xzf "avalanchego-linux-amd64-$TAG.tar.gz"
tar -xzf "subnet-evm-linux-amd64-$TAG.tar.gz"
install -m 0755 "avalanchego-$TAG/avalanchego" "$ROOT/bin/avalanchego"
install -m 0755 "subnet-evm-$TAG/subnet-evm" "$ROOT/plugins/$VM_ID"
"$ROOT/bin/avalanchego" --version

cli="avalanche-cli_${CLI_VER}_linux_amd64.tar.gz"
base="https://github.com/ava-labs/avalanche-cli/releases/download/v$CLI_VER"
curl -fsSL -o "$cli" "$base/$cli"
curl -fsSL -o cli-checksums.txt "$base/avalanche-cli_${CLI_VER}_checksums.txt"
grep " $cli\$" cli-checksums.txt | sha256sum -c -
tar -xzf "$cli" avalanche
install -m 0755 avalanche "$HOME/bin/avalanche"
"$HOME/bin/avalanche" --version
