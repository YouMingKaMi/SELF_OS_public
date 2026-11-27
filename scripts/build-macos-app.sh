#!/bin/sh
# Build and safely install the native macOS WKWebView shell (SELF OS.app).
# Reads COUNCIL_SITE from infra/deploy/site.env (gitignored) unless SELF_OS_URL is set.
set -eu

EXPECTED_BUNDLE_ID="org.personalcouncil.next.mac"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC_DIR="$ROOT/apps/macos"
ICON_SRC="$ROOT/apps/ios/CouncilStudio/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
SITE_ENV="$ROOT/infra/deploy/site.env"
INSTALL_DIR="${SELF_OS_INSTALL_DIR:-/Applications}"
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/self-os-macos-build.XXXXXXXX")
STAGE=""

cleanup() {
  if [ -n "$STAGE" ] && [ -e "$STAGE" ]; then
    rm -rf "$STAGE"
  fi
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ENDPOINT="${SELF_OS_URL:-}"
if [ -z "$ENDPOINT" ] && [ -f "$SITE_ENV" ]; then
  COUNCIL_SITE=$(sed -n 's/^COUNCIL_SITE=//p' "$SITE_ENV" | tail -n 1 | tr -d '[:space:]')
  if [ -n "$COUNCIL_SITE" ]; then
    case "$COUNCIL_SITE" in
      http://*|https://*) ENDPOINT="$COUNCIL_SITE" ;;
      *) ENDPOINT="https://$COUNCIL_SITE" ;;
    esac
  fi
fi

APP_BUNDLE="$BUILD_DIR/SELF OS.app"
CONTENTS="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$SRC_DIR/Info.plist" "$CONTENTS/Info.plist"
if [ -n "$ENDPOINT" ]; then
  plutil -replace CouncilEndpoint -string "$ENDPOINT" "$CONTENTS/Info.plist"
fi
plutil -lint "$CONTENTS/Info.plist" >/dev/null

if [ ! -f "$ICON_SRC" ]; then
  echo "Missing app icon source: $ICON_SRC" >&2
  exit 1
fi
ICONSET="$BUILD_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -s dpiWidth 72 -s dpiHeight 72 -z "$size" "$size" "$ICON_SRC" \
    --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s format png -s dpiWidth 144 -s dpiHeight 144 -z "$double" "$double" "$ICON_SRC" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES_DIR/AppIcon.icns"

ARCH=$(uname -m)
SWIFT_FLAGS="-O -parse-as-library -target ${ARCH}-apple-macos14.0"
if [ "${SELF_OS_DEBUG:-0}" = "1" ]; then
  SWIFT_FLAGS="$SWIFT_FLAGS -D DEBUG"
fi

# shellcheck disable=SC2086
swiftc \
  $SWIFT_FLAGS \
  -framework AppKit \
  -framework WebKit \
  "$SRC_DIR/SelfOSMacCore.swift" \
  "$SRC_DIR/SelfOSMacApp.swift" \
  -o "$MACOS_DIR/SelfOSMac"

codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

ENDPOINT_STATUS="unconfigured"
if [ -n "$ENDPOINT" ]; then
  ENDPOINT_STATUS="configured"
fi

if [ "${SELF_OS_SKIP_INSTALL:-0}" = "1" ]; then
  DEST="${SELF_OS_OUTPUT_APP:-$ROOT/.build/macos/SELF OS.app}"
  LABEL="Built (not installed)"
  # Interpret relative paths before passing them to command-line tools.
  case "$DEST" in /*) ;; *) DEST="$PWD/$DEST" ;; esac
  case "${DEST##*/}" in ?*.app) ;; *) echo "Output must name an .app bundle" >&2; exit 1 ;; esac
  mkdir -p "$(dirname "$DEST")"
else
  case "$INSTALL_DIR" in /*) ;; *) INSTALL_DIR="$PWD/$INSTALL_DIR" ;; esac
  if [ ! -d "$INSTALL_DIR" ]; then
    echo "Install directory does not exist: $INSTALL_DIR" >&2
    exit 1
  fi
  DEST="$INSTALL_DIR/SELF OS.app"
  LABEL="Installed"
fi

swiftc -parse-as-library -D SELFOS_INSTALLER "$SRC_DIR/SelfOSMacCore.swift" -o "$BUILD_DIR/publish-bundle"
STAGE=$(mktemp -d "$(dirname "$DEST")/.selfos-stage.XXXXXXXX")
if [ "${SELF_OS_TEST_FAIL_STAGE_COPY:-0}" = "1" ]; then
  mkdir -p "$STAGE/new.app/Contents"
  echo "partial" > "$STAGE/new.app/Contents/partial"
  echo "Simulated mid-copy failure" >&2
  exit 1
fi
cp -R "$APP_BUNDLE" "$STAGE/new.app"
codesign --verify --deep --strict "$STAGE/new.app"

# Let the publisher attempt the real atomic exchange with a missing source.
if [ "${SELF_OS_TEST_FAIL_PUBLISH:-0}" = "1" ]; then
  mv "$STAGE/new.app" "$STAGE/unavailable.app"
fi
"$BUILD_DIR/publish-bundle" "$STAGE/new.app" "$DEST" "$EXPECTED_BUNDLE_ID"
codesign --verify --deep --strict "$DEST"
echo "$LABEL: $DEST (endpoint: $ENDPOINT_STATUS)"
