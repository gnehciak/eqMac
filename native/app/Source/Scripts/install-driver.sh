#!/bin/sh
#
# install-driver.sh — installs eqMac's virtual audio driver on a fresh Mac.
#
# Runs as root via STPrivilegedTask (the app prompts for an admin password).
# The eqMac.driver bundle ships next to this script inside the app's
# Resources folder, so the script self-locates its source and copies it into
# the system-wide CoreAudio plug-in directory, then restarts coreaudiod so the
# virtual device appears immediately (no reboot needed).
#
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DRIVER_NAME="eqMac.driver"
DRIVER_SRC="$SCRIPT_DIR/$DRIVER_NAME"
HAL_DIR="/Library/Audio/Plug-Ins/HAL"
DRIVER_DEST="$HAL_DIR/$DRIVER_NAME"

if [ ! -d "$DRIVER_SRC" ]; then
  echo "eqMac: bundled driver not found at $DRIVER_SRC" >&2
  exit 1
fi

mkdir -p "$HAL_DIR"

# Remove any previous copy so a downgrade/repair fully replaces it.
rm -rf "$DRIVER_DEST"
cp -R "$DRIVER_SRC" "$HAL_DIR/"

# Ownership must be root:wheel for CoreAudio to load a system plug-in.
chown -R root:wheel "$DRIVER_DEST"
chmod -R 755 "$DRIVER_DEST"

# If the app was downloaded or transferred to this Mac, the bundled driver can
# inherit a quarantine flag; coreaudiod refuses to load quarantined system
# plug-ins, so strip it. (Harmless if it was never quarantined.)
xattr -dr com.apple.quarantine "$DRIVER_DEST" 2>/dev/null || true

# Restart CoreAudio so it rescans the HAL directory and loads the new driver.
# kickstart is the supported path; fall back to a plain signal if SIP or an
# OS variant refuses it.
launchctl kickstart -k system/com.apple.audio.coreaudiod 2>/dev/null \
  || killall coreaudiod 2>/dev/null \
  || true

exit 0
