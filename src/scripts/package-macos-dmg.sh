#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to create macOS DMG packages" >&2
  exit 1
fi

create_app_icon() {
  local resources_dir="$1"
  local work_dir
  work_dir="$(mktemp -d)"
  local base_png="${work_dir}/icon-1024.png"
  local swift_file="${work_dir}/draw-icon.swift"
  local iconset="${work_dir}/AppIcon.iconset"

  mkdir -p "$iconset"
  cat > "$swift_file" <<'SWIFT'
import AppKit

let output = CommandLine.arguments[1]
let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))

image.lockFocus()
let rect = NSRect(x: 0, y: 0, width: size, height: size)
NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
NSBezierPath(roundedRect: rect, xRadius: 188, yRadius: 188).fill()

NSColor(calibratedRed: 0.12, green: 0.86, blue: 0.46, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 676, y: 668, width: 180, height: 180)).fill()

NSColor.white.setFill()
let bubble = NSBezierPath(roundedRect: NSRect(x: 172, y: 258, width: 656, height: 438), xRadius: 120, yRadius: 120)
bubble.fill()
let tail = NSBezierPath()
tail.move(to: NSPoint(x: 292, y: 276))
tail.line(to: NSPoint(x: 210, y: 176))
tail.line(to: NSPoint(x: 386, y: 258))
tail.close()
tail.fill()

let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 250, weight: .black),
  .foregroundColor: NSColor(calibratedWhite: 0.055, alpha: 1)
]
let text = NSString(string: "WA")
let textSize = text.size(withAttributes: attrs)
text.draw(at: NSPoint(x: (size - textSize.width) / 2, y: 372), withAttributes: attrs)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("failed to render icon")
}
try png.write(to: URL(fileURLWithPath: output))
SWIFT

  swift "$swift_file" "$base_png"

  while read -r pixels filename; do
    sips -z "$pixels" "$pixels" "$base_png" --out "${iconset}/${filename}" >/dev/null
  done <<'SIZES'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
SIZES

  iconutil -c icns "$iconset" -o "${resources_dir}/AppIcon.icns"
  rm -rf "$work_dir"
}

create_dmg() {
  local arch="$1"
  local binary="dist/wa-sentinel-darwin-${arch}"
  local app_name="WA Sentinel"
  local bundle_dir="dist/${app_name}-${arch}.app"
  local dmg_path="dist/wa-sentinel-macos-${arch}.dmg"
  local staging_dir

  if [[ ! -f "$binary" ]]; then
    echo "Missing macOS binary: ${binary}" >&2
    exit 1
  fi

  echo "Packaging macOS DMG for ${arch}..."
  rm -rf "$bundle_dir" "$dmg_path"
  mkdir -p "${bundle_dir}/Contents/MacOS" "${bundle_dir}/Contents/Resources"

  cp "$binary" "${bundle_dir}/Contents/MacOS/wa-sentinel-bin"
  chmod +x "${bundle_dir}/Contents/MacOS/wa-sentinel-bin"

  cat > "${bundle_dir}/Contents/MacOS/wa-sentinel-launcher" <<'LAUNCHER'
#!/bin/sh
set -eu

APP_SUPPORT="${HOME}/Library/Application Support/WA Sentinel"
LOG_FILE="${APP_SUPPORT}/wa-sentinel.log"
URL="http://127.0.0.1:3000/"

mkdir -p "${APP_SUPPORT}"
cd "${APP_SUPPORT}"

if /usr/bin/curl -fsS --max-time 1 "${URL}health" >/dev/null 2>&1; then
  /usr/bin/open "${URL}"
  exit 0
fi

BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "${BIN_DIR}/wa-sentinel-bin" rest --host=127.0.0.1 --open-browser=true >>"${LOG_FILE}" 2>&1
LAUNCHER
  chmod +x "${bundle_dir}/Contents/MacOS/wa-sentinel-launcher"

  create_app_icon "${bundle_dir}/Contents/Resources"

  cat > "${bundle_dir}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>WA Sentinel</string>
  <key>CFBundleExecutable</key>
  <string>wa-sentinel-launcher</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.local.wa-sentinel</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>WA Sentinel</string>
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

  printf "APPL????" > "${bundle_dir}/Contents/PkgInfo"

  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$bundle_dir"
  fi

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
