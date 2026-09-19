#!/bin/bash
# Bump the cache-bust version in all frontend asset URLs.
# Run this after modifying JS, CSS, or HTML components.
set -euo pipefail
INDEX="$(cd "$(dirname "$0")/.." && pwd)/frontend/index.html"
OLD=$(grep -oP 'v=\K[0-9]+' "$INDEX" | head -1)
NEW=$((OLD + 1))
echo "Bumping cache version from $OLD → $NEW"
sed -i "s/?v=$OLD/?v=$NEW/g" "$INDEX"
echo "Done. All assets now use ?v=$NEW"
