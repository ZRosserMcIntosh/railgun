# Database Migration Guide

## Running the Auth Session Exchange Token Migration

This migration adds security enhancements to the QR auth flow by implementing one-time exchange tokens.

### Migration Details

**File:** `1736467200000-AddAuthSessionExchangeToken.ts`  
**Date:** 2026-01-09  
**Purpose:** Add exchange token mechanism to prevent replay attacks in QR auth

### What It Does

Adds two columns to the `auth_sessions` table:
- `exchange_token` (varchar 64, nullable) - One-time token for JWT exchange
- `is_exchanged` (boolean, default false) - Tracks if session was already exchanged

Also creates indexes for performance:
- Index on `exchange_token` (sparse - only non-null values)
- Index on `is_exchanged` for cleanup queries

### Running the Migration

#### Development

```bash
cd services/api

# Run the migration
pnpm typeorm migration:run

# To rollback (if needed)
pnpm typeorm migration:revert
```

#### Production

```bash
# Recommended: Backup database first
pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql

# Run migration
cd services/api
NODE_ENV=production pnpm typeorm migration:run

# Verify
psql -h $DB_HOST -U $DB_USER $DB_NAME -c "\d auth_sessions"
```

### Verification

After running the migration, verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'auth_sessions' 
AND column_name IN ('exchange_token', 'is_exchanged');
```

Expected output:
```
    column_name    |     data_type      | is_nullable | column_default 
-------------------+--------------------+-------------+----------------
 exchange_token    | character varying  | YES         | 
 is_exchanged      | boolean            | NO          | false
```

### Rollback

If you need to rollback this migration:

```bash
pnpm typeorm migration:revert
```

This will:
1. Drop the indexes
2. Remove the `is_exchanged` column
3. Remove the `exchange_token` column

### Notes

- This migration is safe to run on existing databases - it only adds columns with safe defaults
- Existing auth sessions will have `exchange_token = NULL` and `is_exchanged = false`
- New sessions created after this migration will populate these fields
- The security fixes in the codebase handle both old and new session formats gracefully
