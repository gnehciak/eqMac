#!/bin/bash
#
# package-app.sh — build a self-contained, self-installing eqMac Reborn.app
#
# Produces an app bundle that installs its own audio driver on first launch
# (admin prompt), with no dependency on a signed installer package and no
# connection to any vendor service. Run from the native/ directory.
#
# Requirements: full Xcode (or Xcode-beta) + CocoaPods, and `pod install`
# already run once in this directory.
#
# Usage:
#   ./package-app.sh [Debug|Release] [output-dir]
#
set -euo pipefail

CONFIG="${1:-Debug}"
OUT_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/build}"
DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"
export DEVELOPER_DIR
DD="$(mktemp -d)/dd"

echo "▸ Building eqMac.app ($CONFIG)…"
xcodebuild -workspace eqMac.xcworkspace -scheme eqMac \
  -configuration "$CONFIG" -derivedDataPath "$DD" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" DEVELOPMENT_TEAM="" build \
  >/tmp/eqmac-package-app.log 2>&1 || { grep -E "error:" /tmp/eqmac-package-app.log | head; exit 1; }

echo "▸ Building eqMac.driver…"
# The driver's post-build phase tries a privileged install and "fails" without
# an askpass helper, but the .driver bundle itself is produced first — so a
# non-zero exit here is expected and ignored.
xcodebuild -workspace eqMac.xcworkspace -scheme "Driver - $CONFIG" \
  -derivedDataPath "$DD" CODE_SIGN_ALLOWED=NO CODE_SIGN_REQUIRED=NO build \
  >/tmp/eqmac-package-driver.log 2>&1 || true

APP="$DD/Build/Products/$CONFIG/eqMac.app"
DRV="$DD/Build/Products/$CONFIG/eqMac.driver"
[ -d "$APP" ] || { echo "✗ app not built"; exit 1; }
[ -d "$DRV" ] || { echo "✗ driver not built"; exit 1; }

echo "▸ Bundling the driver inside the app (for on-launch install)…"
rm -rf "$APP/Contents/Resources/eqMac.driver"
cp -R "$DRV" "$APP/Contents/Resources/eqMac.driver"

echo "▸ Ad-hoc signing (app + nested driver)…"
codesign --force --deep --sign - "$APP"

mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR/eqMac.app" "$OUT_DIR/eqMac.driver"
cp -R "$APP" "$OUT_DIR/eqMac.app"
cp -R "$DRV" "$OUT_DIR/eqMac.driver"   # standalone copy for manual install

echo "✓ Done: $OUT_DIR/eqMac.app"
echo "  First launch will prompt to install the audio driver (admin password)."
