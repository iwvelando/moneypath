#!/bin/sh
# Regenerate committed PNG icons from the compact branching-path geometry.
# Keep paths in sync with public/favicon.svg and BrandMark in icons.tsx.
# ImageMagick primitives avoid platform differences in SVG delegates.
# Usage: sh web/scripts/make-favicons.sh (from the repository root)
set -eu

out="$(CDPATH= cd -- "$(dirname -- "$0")/../public" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Draw at 16x resolution for clean small-size antialiasing.
mark() {
  magick "$1" \
    -draw "scale 16,16 stroke-linecap round stroke-linejoin round fill none stroke '#ddb180' stroke-width 1.7 path 'M12 19C18 24 23 17 28 17' stroke '#95c8ad' stroke-width 2 path 'M4 25C8 25 8 18 12 19S20 10 28 6' fill '#192622' stroke-width 1.6 circle 4,25 5.8,25 circle 12,19 13.8,19 circle 28,6 29.8,6" \
    "$2"
}

magick -size 512x512 xc:none -fill '#192622' -draw "roundrectangle 0,0 512,512 96,96" "$work/rounded.png"
magick -size 512x512 xc:'#192622' "$work/full.png"
mark "$work/rounded.png" "$work/icon.png"
mark "$work/full.png" "$work/touch.png"
magick "$work/icon.png" -resize 32x32 "$out/favicon-32.png"
# iOS applies its own corner mask; the touch icon is opaque and full bleed.
magick "$work/touch.png" -alpha off -resize 180x180 "$out/apple-touch-icon.png"
echo "wrote $out/apple-touch-icon.png and $out/favicon-32.png"
