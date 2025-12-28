#!/bin/bash
#
# Database Restore Script
#
# Restores a pg_dump backup to the database.
# ⚠️  WARNING: This will DROP and recreate all tables!
#
# Usage:
#   pnpm db:restore path/to/backup.sql.gz
#   ./scripts/restore-db.sh path/to/backup.sql.gz
#
# Environment:
#   DATABASE_URL - Full connection string (Supabase)
#   OR individual: DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME

set -e

# Load .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "❌ Error: Please provide a backup file path"
  echo "Usage: pnpm db:restore path/to/backup.sql.gz"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "⚠️  WARNING: This will DROP and recreate all tables!"
echo "   Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no) " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "🗄️  Starting database restore..."

# Determine if file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
  DECOMPRESS="gunzip -c"
else
  DECOMPRESS="cat"
fi

if [ -n "$DATABASE_URL" ]; then
  # Use DATABASE_URL (Supabase/production)
  echo "   Using DATABASE_URL connection"
  $DECOMPRESS "$BACKUP_FILE" | psql "$DATABASE_URL"
else
  # Use individual params (local dev)
  echo "   Using individual connection params"
  $DECOMPRESS "$BACKUP_FILE" | PGPASSWORD="${DATABASE_PASSWORD:-railgun_dev_password}" psql \
    -h "${DATABASE_HOST:-localhost}" \
    -p "${DATABASE_PORT:-5432}" \
    -U "${DATABASE_USER:-railgun}" \
    -d "${DATABASE_NAME:-railgun}"
fi

echo ""
echo "✅ Restore complete!"
echo ""
echo "💡 Run migrations to ensure schema is up to date:"
echo "   pnpm migration:run"
