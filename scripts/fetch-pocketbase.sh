#!/usr/bin/env bash
# Télécharge le binaire PocketBase officiel, version épinglée, avec vérification du checksum.
set -euo pipefail
VERSION="${PB_VERSION:-0.40.6}"
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "Architecture non gérée"; exit 1;; esac
case "$(uname -s)" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "OS non géré"; exit 1;; esac
DIR="$(cd "$(dirname "$0")/.." && pwd)/pocketbase"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ZIP="pocketbase_${VERSION}_${OS}_${ARCH}.zip"
BASE="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}"
curl -fsSL "$BASE/$ZIP" -o "$TMP/$ZIP"
curl -fsSL "$BASE/checksums.txt" -o "$TMP/checksums.txt"
(cd "$TMP" && grep " $ZIP\$" checksums.txt | sha256sum -c -)
unzip -o -q "$TMP/$ZIP" pocketbase -d "$DIR"
chmod +x "$DIR/pocketbase"
"$DIR/pocketbase" --version
