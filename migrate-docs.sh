#!/bin/bash
# migrate-docs.sh
# Run this script to migrate from old docs structure to new consolidated docs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
OLD_DOCS="$PROJECT_ROOT/docs"
NEW_DOCS="$PROJECT_ROOT/docs-new"
ARCHIVE="$PROJECT_ROOT/docs-archive"

if [ ! -d "$NEW_DOCS" ]; then
    echo "❌ Expected docs-new/ at: $NEW_DOCS"
    echo "Aborting migration to avoid deleting docs/ without a replacement."
    exit 1
fi

echo "📦 Creating archive of old docs..."
mkdir -p "$ARCHIVE"

# Archive old docs folder
if [ -d "$OLD_DOCS" ]; then
    cp -r "$OLD_DOCS"/* "$ARCHIVE/" 2>/dev/null || true
    echo "  ✓ Archived docs/ folder"
fi

# Archive root-level md files (except README, CHANGELOG, SECURITY, LICENSE)
for file in "$PROJECT_ROOT"/*.md; do
    filename=$(basename "$file")
    case "$filename" in
        README.md|CHANGELOG.md|SECURITY.md|LICENSE.md)
            echo "  - Keeping $filename in root"
            ;;
        *)
            cp "$file" "$ARCHIVE/" 2>/dev/null || true
            echo "  ✓ Archived $filename"
            ;;
    esac
done

echo ""
echo "🔄 Replacing docs/ with consolidated docs..."

# Remove old docs folder
rm -rf "$OLD_DOCS"

# Move new docs to docs/
mv "$NEW_DOCS" "$OLD_DOCS"

echo ""
echo "🗑️  Removing redundant root-level md files..."

# Remove redundant root-level files
REMOVE_FILES=(
    "BOOT.md"
    "DEV_SETUP.md"
    "QUICK_START.md"
    "RELEASE.md"
    "DELIVERY_SUMMARY.md"
    "VERIFICATION_REPORT.md"
    "PROJECT_COMPLETION_SUMMARY.md"
    "IMPLEMENTATION_SUMMARY.md"
    "SECURITY_ENHANCEMENT_COMPLETE.md"
    "SHARE_WITH_FRIENDS.md"
    "WEBSITE_DOWNLOAD_CHECKLIST.md"
)

for file in "${REMOVE_FILES[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        rm "$PROJECT_ROOT/$file"
        echo "  ✓ Removed $file"
    fi
done

echo ""
echo "✅ Migration complete!"
echo ""
echo "New structure:"
echo "  docs/"
ls -1 "$OLD_DOCS"
echo ""
echo "Archived old docs in: docs-archive/"
echo ""
echo "You can safely delete docs-archive/ after verifying the new docs."
