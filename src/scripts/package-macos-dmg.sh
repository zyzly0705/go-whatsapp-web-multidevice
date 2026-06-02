#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to create macOS DMG packages" >&2
  exit 1
fi

create_dmg() {
  local arch="$1"
  local binary="dist/wa-alert-darwin-${arch}"
  local app_name="WA Alert"
  local bundle_dir="dist/${app_name}-${arch}.app"
  local dmg_path="dist/wa-alert-macos-${arch}.dmg"
  local staging_dir

  if [[ ! -f "$binary" ]]; then
    echo "Missing macOS binary: ${binary}" >&2
    exit 1
  fi

  echo "Packaging macOS DMG for ${arch}..."
  rm -rf "$bundle_dir" "$dmg_path"
  mkdir -p "${bundle_dir}/Contents/MacOS"

  cp "$binary" "${bundle_dir}/Contents/MacOS/wa-alert"
  chmod +x "${bundle_dir}/Contents/MacOS/wa-alert"

  cat > "${bundle_dir}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>WA Alert</string>
  <key>CFBundleExecutable</key>
  <string>wa-alert</string>
  <key>CFBundleIdentifier</key>
  <string>com.local.wa-alert</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>WA Alert</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  staging_dir="$(mktemp -d)"
  cp -R "$bundle_dir" "${staging_dir}/${app_name}.app"
  ln -s /Applications "${staging_dir}/Applications"

  hdiutil create \
    -volname "$app_name" \
    -srcfolder "$staging_dir" \
    -ov \
    -format UDZO \
    "$dmg_path"

  rm -rf "$staging_dir"
}

create_dmg arm64
create_dmg amd64

echo "Done. DMG packages are in src/dist/"
