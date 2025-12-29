# Rail Gun - Development Setup Guide

## Quick Start

### 1. Start Docker Desktop
Open Docker Desktop app on your Mac. Wait for it to fully start (whale icon in menu bar should be steady).

### 2. Start Local Infrastructure
```bash
cd infra
docker-compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379

### 3. Start API Server
```bash
cd services/api
pnpm dev
```

The API will be available at `http://localhost:3001`

### 4. Start Desktop App
```bash
cd apps/desktop
pnpm dev
```

The Electron app will launch automatically.

---

## Current Status

### ✅ Fixed Issues
1. **CSP Error** - Google Fonts now allowed in Electron
2. **Redis Fallback** - Mock client for development without Redis
3. **TypeScript Errors** - Billing module excluded temporarily

### ❌ Known Issues
1. **Docker not running** - You need to start Docker Desktop manually
2. **Postgres not available** - Will work once Docker starts
3. **Supabase hostname not resolving** - Verify project ID or use local DB

---

## Without Docker (Supabase Alternative)

If you prefer to use Supabase instead of local Docker:

1. **Verify Supabase Project**:
   - Go to https://supabase.com/dashboard
   - Check if project `rcqbgqugjitdtyrpsgwd` is active
   - If paused, click "Resume Project"

2. **Get Connection String**:
   - Project Settings → Database → Connection string → URI
   - Copy the full `postgresql://...` string

3. **Update .env**:
   ```bash
   cd services/api
   # Edit .env and uncomment DATABASE_URL with your connection string
   ```

4. **Start API** (Redis will use mock client):
   ```bash
   pnpm dev
   ```

---

## Troubleshooting

### "Cannot connect to Docker daemon"
→ Start Docker Desktop application

### "ECONNREFUSED localhost:5432"
→ Run `docker-compose up -d` in the `infra/` directory

### "ERR_CONNECTION_REFUSED localhost:3001"
→ API isn't running. Start with `cd services/api && pnpm dev`

### "CSP violation for fonts.googleapis.com"
→ Already fixed in `electron/main.ts`. Restart the desktop app.

### Desktop app won't start
→ Check if port 5173 is available: `lsof -ti:5173 | xargs kill -9`

---

## Next Steps

Once everything is running:

1. **Run Migrations**:
   ```bash
   cd services/api
   pnpm migration:run
   ```

2. **Test QR Auth**:
   - Open desktop app
   - Click "Login with Mobile" (once UI is wired up)
   - QR code should display

3. **Check API Health**:
   ```bash
   curl http://localhost:3001/health
   ```

---

## Architecture Reference

```
┌─────────────────┐
│  Desktop App    │  Port 5173 (dev) → Electron
│  (Vite + React) │  
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   API Server    │  Port 3001 (NestJS)
│                 │  
└────────┬────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌────────┐ ┌───────┐
│Postgres│ │ Redis │
│ :5432  │ │ :6379 │
└────────┘ └───────┘
```

---

## Environment Files

- `services/api/.env` - API configuration (DB, Redis, JWT secrets)
- `apps/desktop/.env` - Desktop app config (if needed)

**Never commit .env files!** They're in `.gitignore`.

---

## Documentation

- [Database Operations](../docs/DATABASE_OPERATIONS.md) - Migrations, backups, Supabase setup
- [Market Readiness](../docs/MARKET_READINESS.md) - Full roadmap and progress
- [PRO Runbook](../docs/PRO_RUNBOOK.md) - Production deployment guide
