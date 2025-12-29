# Database Operations Guide

## Overview

Rail Gun uses PostgreSQL with TypeORM for data persistence. The configuration supports:
- **Local development**: Direct Postgres connection
- **Production**: Supabase (or any managed Postgres with SSL)

---

## Quick Start

### Local Development (Docker)

```bash
# Start local Postgres + Redis
cd infra && docker-compose up -d

# Copy environment file
cd services/api
cp .env.example .env

# Run migrations
pnpm migration:run

# Start API
pnpm dev
```

### Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Get connection string: **Project Settings → Database → Connection string → URI**
3. Add to `.env`:
   ```
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
4. Run migrations:
   ```bash
   pnpm migration:run
   ```

---

## Migrations

### Commands

```bash
# Generate migration from entity changes (auto-detect)
pnpm migration:generate src/migrations/AddUserAvatar

# Create empty migration (manual SQL)
pnpm migration:create src/migrations/CustomIndexes

# Run pending migrations
pnpm migration:run

# Revert last migration
pnpm migration:revert

# Show migration status
pnpm migration:show

# Sync schema (⚠️ DEV ONLY - destructive!)
pnpm schema:sync

# Drop all tables (⚠️ DANGEROUS!)
pnpm schema:drop
```

### Migration Best Practices

1. **Never use `synchronize: true` in production** - Always use migrations
2. **Test migrations locally first** - Run against a local copy before production
3. **Keep migrations atomic** - One logical change per migration
4. **Use transactions** - TypeORM migrations run in transactions by default
5. **Avoid Supabase-specific features** - Stick to pure SQL for portability

### Example Migration

```typescript
// src/migrations/1735236000000-AddUserStatus.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserStatus1735236000000 implements MigrationInterface {
  name = 'AddUserStatus1735236000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "status" varchar(20) DEFAULT 'active'
    `);
    
    await queryRunner.query(`
      CREATE INDEX "IDX_users_status" ON "users" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_status"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status"`);
  }
}
```

---

## Backup & Restore

### Create Backup

```bash
# Backup to ./backups/ directory
pnpm db:backup

# Backup to custom directory
./scripts/backup-db.sh /path/to/backups
```

Output: `railgun_backup_20251226_143022.sql.gz`

### Restore Backup

```bash
# ⚠️ WARNING: This drops existing data!
pnpm db:restore backups/railgun_backup_20251226_143022.sql.gz
```

### Automated Backups

For production, set up a cron job or GitHub Action:

```yaml
# .github/workflows/db-backup.yml
name: Daily Database Backup
on:
  schedule:
    - cron: '0 3 * * *'  # 3 AM UTC daily
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Backup database
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          cd services/api
          ./scripts/backup-db.sh ./backup
      - name: Upload to S3
        uses: jakejarvis/s3-sync-action@v0.5.1
        with:
          args: --acl private
        env:
          AWS_S3_BUCKET: ${{ secrets.AWS_BACKUP_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          SOURCE_DIR: services/api/backup
```

---

## Connection Pooling

### Supabase Free Tier Limits

- **Direct connections**: ~60 max
- **Connection timeout**: 10 seconds
- **Idle timeout**: 5 minutes

### Recommended Settings

```bash
# .env for Supabase free tier
DATABASE_POOL_MAX=10
```

The app.module.ts is configured with:
- Pool max: 10 connections
- Idle timeout: 30 seconds
- Connection timeout: 10 seconds
- Retry attempts: 10 (production) / 3 (development)

---

## Security Checklist

### Supabase Settings

- [ ] Enable **SSL enforcement** (Project Settings → Database → SSL)
- [ ] Enable **Database backups** (Pro plan for PITR)
- [ ] Set **Row Level Security** policies (even if basic)
- [ ] Use **service_role** key only server-side
- [ ] Create **separate DB user** for app (minimal privileges)
- [ ] Create **separate DB user** for migrations (DDL privileges)

### Connection String Security

```bash
# ✅ Good: Use environment variables
DATABASE_URL=$DATABASE_URL

# ❌ Bad: Hardcoded in code
DATABASE_URL=postgresql://postgres:mypassword@...
```

### Sensitive Data

- **Encrypt sensitive columns** client-side where feasible
- **Minimize PII storage** - only what's absolutely necessary
- **Hash secrets** with argon2 (never store plaintext)
- **Use billing_ref surrogates** instead of user IDs for billing

---

## Migration from Supabase

When ready to migrate to self-hosted or another provider:

### 1. Ensure Migrations Are Up to Date

```bash
pnpm migration:show  # All should be [X] executed
```

### 2. Export Data

```bash
pnpm db:backup
# Creates: backups/railgun_backup_YYYYMMDD_HHMMSS.sql.gz
```

### 3. Set Up New Database

```bash
# Create new Postgres instance (Railway, Fly.io, AWS RDS, etc.)
# Get the new DATABASE_URL

# Restore backup
DATABASE_URL=postgresql://... pnpm db:restore backups/railgun_backup_xxx.sql.gz

# Run migrations to ensure schema matches
DATABASE_URL=postgresql://... pnpm migration:run
```

### 4. Switch Over

1. Put app in **maintenance mode**
2. Take **final backup** from Supabase
3. Restore to new database
4. Update **DATABASE_URL** in production environment
5. Deploy and verify
6. Keep Supabase **read-only** for 24-48 hours as fallback
7. Decommission Supabase project

---

## Troubleshooting

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution**: Start local Postgres or set DATABASE_URL for cloud.

### SSL Required

```
Error: SSL/TLS required
```

**Solution**: Ensure DATABASE_URL includes SSL params or set:
```bash
DATABASE_URL=postgresql://...?sslmode=require
```

### Too Many Connections

```
Error: remaining connection slots are reserved
```

**Solution**: Reduce `DATABASE_POOL_MAX` in .env (try 5-10).

### Migration Failed

```
Error: migration "xxx" has already been applied
```

**Solution**: Check `typeorm_migrations` table. If corrupted:
```sql
DELETE FROM typeorm_migrations WHERE name = 'xxx';
```

---

## Performance Tips

1. **Use indexes** for frequently queried columns
2. **Add composite indexes** for common WHERE clauses
3. **Use EXPLAIN ANALYZE** to check query plans
4. **Paginate large queries** - never SELECT * without LIMIT
5. **Use connection pooling** - PgBouncer for high traffic
6. **Monitor slow queries** - Supabase has built-in query insights
