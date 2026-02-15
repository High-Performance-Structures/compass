#!/bin/bash
# Generate placeholder PNG icons from SVG using ImageMagick if available
# Falls back to creating minimal placeholder files

if command -v convert &> /dev/null; then
    convert icon.svg icon.png
    convert icon.svg -resize 32x32 32x32.png
    convert icon.svg -resize 128x128 128x128.png
    convert icon.svg -resize 256x256 128x128@2x.png
    convert icon.svg -resize 512x512 icon.icns 2>/dev/null || cp icon.png icon.icns
    convert icon.svg -resize 256x256 icon.ico 2>/dev/null || cp icon.png icon.ico
    echo "Icons generated with ImageMagick"
else
    echo "ImageMagick not found - creating placeholder icon files"
    # Create minimal placeholder files (1x1 blue pixel)
    echo "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAADklEQVRYR+3BAQ0AAADCoPdPbQ43oAAA" | base64 -d > icon.png 2>/dev/null || touch icon.png
    cp icon.png 32x32.png
    cp icon.png 128x128.png
    cp icon.png "128x128@2x.png"
    cp icon.png icon.icns
    cp icon.png icon.ico
    echo "Placeholder icons created - replace with proper icons before release"
fi
