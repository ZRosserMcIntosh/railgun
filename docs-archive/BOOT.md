# Rail Gun - Boot Checklist

Complete stack boot on MacBook. Run this every time you want to develop.

---

## Prerequisites (One-Time Setup)

### 1. Install Docker Desktop

Rail Gun needs Postgres + Redis. Easiest way is Docker.

1. Download **Docker Desktop for Mac**: https://www.docker.com/products/docker-desktop/
2. Install and **open Docker Desktop**
3. Wait for Docker to fully start (whale icon in menu bar)
4. Verify:
   ```bash
   docker --version
   docker ps
   ```

### 2. Install Dependencies

From project root:

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"
pnpm install
```

This installs all workspace dependencies (shared, api, desktop).

### 3. Configure Backend Environment

```bash
cd services/api
cp .env.example .env
```

**The default `.env.example` values are already correct for local dev!**

Default config:
- Database: `localhost:5432`, user `railgun`, password `railgun_dev_password`, db `railgun`
- Redis: `localhost:6379`, no password
- JWT Secret: `your-super-secret-jwt-key-change-in-production`
- API Port: `3001`

**No changes needed** unless you want custom values.

---

## Daily Boot Sequence

Run these commands in order, each in their own terminal tab/window:

### Terminal 1: Infrastructure (Postgres + Redis)

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"

# Start Docker containers
pnpm infra:start

# Or manually:
# cd infra && docker compose up -d
```

**Verify containers are running:**

```bash
docker ps
```

You should see:
- `railgun-postgres` on port 5432
- `railgun-redis` on port 6379

**Health check:**

```bash
# Postgres
docker exec railgun-postgres pg_isready -U railgun

# Redis
docker exec railgun-redis redis-cli ping
```

### Terminal 2: API Server

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"

# Start backend API
pnpm dev:api
```

**Wait for:** `Nest application successfully started` message.

**API runs on:** `http://localhost:3001`

**Test health endpoint:**

```bash
curl http://localhost:3001/api/v1/health
```

Should return JSON like `{"status":"ok"}`.

### Terminal 3: Desktop App

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"

# Start Electron app with hot reload
pnpm dev:desktop
```

Electron window should open with the login screen.

---

## First-Time Account Creation

### Option A: Via Desktop App (Recommended)

1. **Open the desktop app** (Terminal 3 above)
2. Click **"Register"** link at the bottom
3. Fill out:
   - Username: `rosser` (or whatever you want)
   - Email: `you@example.com`
   - Password: `SomePassword123` (min 8 chars)
   - Confirm Password: same
4. Click **"Create Account"**
5. You should be auto-logged in and see the main chat layout

### Option B: Via cURL (For Testing)

**Register:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "rosser",
    "email": "rosser@example.com",
    "password": "SomeStrongPassword123"
  }'
```

**Login:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "rosser",
    "password": "SomeStrongPassword123"
  }'
```

Both should return JSON with `accessToken` and user info.

---

## Shutdown Sequence

### Stop Desktop App

Just close the Electron window or `Ctrl+C` in Terminal 3.

### Stop API Server

`Ctrl+C` in Terminal 2.

### Stop Infrastructure

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"

pnpm infra:stop

# Or manually:
# cd infra && docker compose down
```

This stops containers but **keeps data** (postgres_data, redis_data volumes).

**To nuke everything and start fresh:**

```bash
cd infra
docker compose down -v  # Removes volumes too
```

---

## Troubleshooting

### "Cannot connect to backend" in Desktop App

**Check:**

1. Is API running? `curl http://localhost:3001/api/v1/health`
2. Is Docker running? `docker ps`
3. Open DevTools in Electron (`Cmd+Option+I`) → Console tab → look for network errors

**Common fixes:**

- API isn't started: Go to Terminal 2, run `pnpm dev:api`
- Port mismatch: API must be on `3001` (check `services/api/.env` PORT var)
- CORS issue: `services/api/.env` should have `CORS_ORIGINS=http://localhost:5173,http://localhost:3000`

### "Database connection error" in API

**Check:**

1. Is Postgres running? `docker ps | grep postgres`
2. Is Postgres healthy? `docker exec railgun-postgres pg_isready -U railgun`

**Fix:**

```bash
# Restart containers
pnpm infra:stop
pnpm infra:start
```

### "Port already in use" errors

**API (port 3001):**

```bash
lsof -ti:3001 | xargs kill -9
```

**Postgres (port 5432):**

```bash
lsof -ti:5432 | xargs kill -9
# Or stop local Postgres if you have one installed
brew services stop postgresql
```

**Desktop dev server (port 5173):**

```bash
lsof -ti:5173 | xargs kill -9
```

### Reset Database (Nuclear Option)

```bash
cd infra
docker compose down -v  # Removes all data
docker compose up -d    # Fresh start
```

Then restart API server (Terminal 2).

---

## Architecture Summary

**Stack Overview:**

```
┌─────────────────────────────────────────┐
│  Desktop App (Electron + React)         │
│  http://localhost:5173 (dev server)     │
│  Vite + HMR                              │
└────────────┬────────────────────────────┘
             │
             │ HTTP + WebSocket
             ▼
┌─────────────────────────────────────────┐
│  API Server (NestJS)                     │
│  http://localhost:3001/api/v1            │
│  JWT auth, REST + WebSocket gateway     │
└────┬───────────────────────┬────────────┘
     │                       │
     │                       │
     ▼                       ▼
┌──────────────┐      ┌──────────────┐
│  PostgreSQL  │      │    Redis     │
│  port 5432   │      │  port 6379   │
│  (Docker)    │      │  (Docker)    │
└──────────────┘      └──────────────┘
```

**API Endpoints (examples):**

- `POST /api/v1/auth/register` - Create account
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/health` - Health check
- `POST /api/v1/keys/register` - Register device keys
- `GET /api/v1/communities` - List communities
- WebSocket: `/` (gateway for real-time messages)

---

## Next Steps After Boot

Once everything is running and you've logged in:

1. **Join/create a community** (if implemented in UI)
2. **Send a message** - should be E2E encrypted
3. **Check backend logs** (Terminal 2) to see encryption/decryption happening
4. **Open DevTools** in Electron to inspect network/WebSocket traffic

---

## Pro Tips

**Background startup:**

If you get tired of 3 terminals, use `tmux` or `screen`:

```bash
# Install tmux
brew install tmux

# Start session
tmux new -s railgun

# Split windows:
# Ctrl+B then " (horizontal split)
# Ctrl+B then % (vertical split)
# Ctrl+B then arrow keys (navigate)
```

**Or use VS Code tasks** - we can set those up later.

**Alias for quick boot:**

Add to your `~/.zshrc`:

```bash
alias railgun-boot='cd "/Users/rossermcintosh/Desktop/Rail Gun" && pnpm infra:start && echo "Infra started. Now run: pnpm dev:api (in tab 2) and pnpm dev:desktop (in tab 3)"'
```

---

## Support

If something breaks:

1. Check this file first
2. Look at logs in Terminal 2 (API) and DevTools (Desktop)
3. Post error messages in chat

**End of boot checklist.**
