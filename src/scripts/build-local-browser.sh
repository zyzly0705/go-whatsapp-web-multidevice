#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist

build_target() {
  local goos="$1"
  local goarch="$2"
  local ext=""
  if [[ "$goos" == "windows" ]]; then
    ext=".exe"
  fi

  echo "Building ${goos}/${goarch}..."
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -tags purego -ldflags "-s -w" -o "dist/wa-alert-${goos}-${goarch}${ext}" .
}

build_target darwin arm64
build_target darwin amd64
build_target windows amd64

echo "Done. Binaries are in src/dist/"
