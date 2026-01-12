#!/bin/bash
#
# Rail Gun Release Script
# Creates a GitHub release and uploads build artifacts
#
# Usage: ./scripts/release.sh <version> [channel]
# Example: ./scripts/release.sh 0.1.0 stable
#

set -e

VERSION="${1:-0.1.0}"
CHANNEL="${2:-stable}"
GITHUB_REPO="ZRosserMcIntosh/railgun"

echo "🚀 Rail Gun Release v${VERSION} (${CHANNEL})"
echo "================================================"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "   Install it with: brew install gh"
    echo "   Then authenticate with: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo "   Run: gh auth login"
    exit 1
fi

# Build all platforms (comment out ones you don't need)
echo ""
echo "📦 Building desktop apps..."

# Build macOS
echo "  → Building macOS..."
pnpm --filter @railgun/desktop build:mac

# Build Windows  
echo "  → Building Windows..."
pnpm --filter @railgun/desktop build:win

# Build Linux (uncomment if needed)
# echo "  → Building Linux..."
# pnpm --filter @railgun/desktop build:linux

# List artifacts
RELEASE_DIR="apps/desktop/release"
echo ""
echo "📁 Built artifacts:"
ls -la "$RELEASE_DIR"/*.{exe,dmg,zip,AppImage,deb} 2>/dev/null || true

# Generate checksums
echo ""
echo "🔐 Generating checksums..."
cd "$RELEASE_DIR"
shasum -a 256 *.exe *.dmg *.zip *.AppImage *.deb 2>/dev/null > SHA256SUMS.txt || true
cat SHA256SUMS.txt
cd - > /dev/null

# Create the release
echo ""
echo "📤 Creating GitHub release v${VERSION}..."

RELEASE_NOTES="## Rail Gun v${VERSION}

### Changes
- See CHANGELOG.md for details

### Downloads
| Platform | Download |
|----------|----------|
| Windows | Rail Gun-${VERSION}-Setup.exe |
| macOS | Rail Gun-${VERSION}-arm64.dmg |
| Linux | Rail Gun-${VERSION}.AppImage |

### Verification
Download SHA256SUMS.txt and verify:
\`\`\`bash
sha256sum -c SHA256SUMS.txt
\`\`\`
"

# Create release (draft first to upload files)
gh release create "v${VERSION}" \
    --repo "${GITHUB_REPO}" \
    --title "Rail Gun v${VERSION}" \
    --notes "${RELEASE_NOTES}" \
    --draft \
    "${RELEASE_DIR}"/*.exe \
    "${RELEASE_DIR}"/*.dmg \
    "${RELEASE_DIR}"/*.zip \
    "${RELEASE_DIR}"/SHA256SUMS.txt \
    2>/dev/null || echo "Note: Some files may not exist"

echo ""
echo "✅ Draft release created!"
echo ""
echo "Next steps:"
echo "1. Go to https://github.com/${GITHUB_REPO}/releases"
echo "2. Review the draft release"
echo "3. Add release notes from CHANGELOG.md"
echo "4. Click 'Publish release'"
echo ""
echo "Your friend can then download from:"
echo "https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/Rail%20Gun-${VERSION}-Setup.exe"
