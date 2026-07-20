#!/bin/bash
# Install the JCut.AI companion panel into Premiere Pro (macOS).
# CEP extensions load from the user extensions folder; unsigned panels need
# PlayerDebugMode enabled for each CSXS runtime version.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.jcutai.panel"

mkdir -p "$DEST"
rsync -a --delete --exclude install.sh --exclude README.md "$SRC/" "$DEST/"

# Allow unsigned (development) panels across recent CEP runtimes.
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null || true
done

echo "Installed to: $DEST"
echo "Restart Premiere Pro, then open: Window > Extensions > JCut.AI"
