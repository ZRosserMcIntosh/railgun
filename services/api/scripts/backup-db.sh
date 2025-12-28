#!/bin/bash
#
# Database Backup Script
# 
# Creates a pg_dump backup of the database.
# Works with both local Postgres and Supabase (via DATABASE_URL).
#
# Usage:
#   pnpm db:backup
#   ./scripts/backup-db.sh [output-dir]
#
# Environment:
#   DATABASE_URL - Full connection string (Supabase)
#   OR individual: DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME

set -e

# Load .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Output directory
BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"

# Timestamp for filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/railgun_backup_$TIMESTAMP.sql"

echo "🗄️  Starting database backup..."

if [ -n "$DATABASE_URL" ]; then
  # Use DATABASE_URL (Supabase/production)
  echo "   Using DATABASE_URL connection"
  pg_dump "$DATABASE_URL" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --format=plain \
    > "$BACKUP_FILE"
else
  # Use individual params (local dev)
  echo "   Using individual connection params"
  PGPASSWORD="${DATABASE_PASSWORD:-railgun_dev_password}" pg_dump \
    -h "${DATABASE_HOST:-localhost}" \
    -p "${DATABASE_PORT:-5432}" \
    -U "${DATABASE_USER:-railgun}" \
    -d "${DATABASE_NAME:-railgun}" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --format=plain \
    > "$BACKUP_FILE"
fi

# Compress the backup
gzip "$BACKUP_FILE"
BACKUP_FILE="$BACKUP_FILE.gz"

# Calculate size
SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

echo "✅ Backup complete!"
echo "   File: $BACKUP_FILE"
echo "   Size: $SIZE"

# Keep only last 7 daily backups (optional cleanup)
find "$BACKUP_DIR" -name "railgun_backup_*.sql.gz" -mtime +7 -delete 2>/dev/null || true

echo ""
echo "💡 To restore: pnpm db:restore $BACKUP_FILE"
