#!/bin/sh
# Regenerate the raster favicons in web/public/ from the same geometry as
# public/favicon.svg and the BrandMark component in src/components/icons.tsx.
#
# The PNGs are committed (a fresh checkout must not need ImageMagick), so run
# this only when the mark itself changes — then commit what it produces.
#
# ImageMagick's own SVG renderer ignores the gradient and the stroked path, so
# the shapes are drawn with draw primitives here rather than rasterized from
# the SVG. Coordinates are the SVG's 32-unit grid scaled by 16.
#
#   usage: sh web/scripts/make-favicons.sh   (from the repository root)

set -eu

out="$(CDPATH= cd -- "$(dirname -- "$0")/../public" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

magick -size 512x512 -define gradient:direction=SouthEast \
  gradient:'#2f6fbe'-'#173f78' "$work/tile.png"

magick -size 512x512 xc:black -fill white \
  -draw "roundrectangle 16,16 496,496 128,128" "$work/mask.png"

magick "$work/tile.png" "$work/mask.png" -alpha off -compose CopyOpacity -composite \
  -stroke '#f4f8ff' -strokewidth 38 -fill none \
  -draw "stroke-linecap round stroke-linejoin round polyline 112,368 208,264 288,304 400,152" \
  -stroke none -fill '#f4f8ff' \
  -draw "circle 112,368 112,395" \
  -draw "circle 208,264 208,291" \
  -draw "circle 288,304 288,331" \
  -draw "circle 400,152 400,194" \
  -fill '#173f78' -draw "circle 400,152 400,170" \
  "$work/icon-512.png"

magick "$work/icon-512.png" -resize 180x180 "$out/apple-touch-icon.png"
magick "$work/icon-512.png" -resize 32x32 "$out/favicon-32.png"

echo "wrote $out/apple-touch-icon.png and $out/favicon-32.png"
