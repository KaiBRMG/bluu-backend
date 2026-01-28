#!/bin/bash

# Script to generate proper icon formats from bluu-logo.png
# This creates macOS ICNS and Windows ICO files from your PNG

echo "Generating app icons from bluu-logo.png..."

# Check if source icon exists
if [ ! -f "public/logo/bluu-logo.png" ]; then
    echo "Error: public/logo/bluu-logo.png not found!"
    exit 1
fi

# Create icon directory if it doesn't exist
mkdir -p public/logo/icon.iconset

# Generate different sizes for macOS ICNS
echo "Creating macOS icon sizes..."
sips -z 16 16     public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_16x16.png
sips -z 32 32     public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_16x16@2x.png
sips -z 32 32     public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_32x32.png
sips -z 64 64     public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_32x32@2x.png
sips -z 128 128   public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_128x128.png
sips -z 256 256   public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_128x128@2x.png
sips -z 256 256   public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_256x256.png
sips -z 512 512   public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_256x256@2x.png
sips -z 512 512   public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_512x512.png
sips -z 1024 1024 public/logo/bluu-logo.png --out public/logo/icon.iconset/icon_512x512@2x.png

# Convert to ICNS (macOS)
echo "Creating icon.icns for macOS..."
iconutil -c icns public/logo/icon.iconset -o public/logo/icon.icns

# Clean up iconset folder
rm -rf public/logo/icon.iconset

echo "✅ Icon generation complete!"
echo "Created: public/logo/icon.icns (macOS)"
echo ""
echo "Note: For Windows .ico files, electron-builder will automatically convert"
echo "your PNG during the build process."
