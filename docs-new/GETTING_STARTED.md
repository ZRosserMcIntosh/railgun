# Getting Started with Rail Gun

Last updated: December 28, 2025

This guide covers everything you need to get Rail Gun running - from initial setup to sharing with friends.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Development)](#quick-start-development)
3. [Building for Distribution](#building-for-distribution)
4. [Sharing with Friends](#sharing-with-friends)
5. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 20+ | JavaScript runtime |
| pnpm | 9+ | Package manager |
| Docker Desktop | Latest | Local Postgres & Redis |

### Installation

**macOS (Homebrew):**
```bash
brew install node@20 pnpm
brew install --cask docker
```

**Windows:**
- Download Node.js from https://nodejs.org
- Run `npm install -g pnpm`
- Download Docker Desktop from https://docker.com

---

## Quick Start (Development)

### 1. Start Docker Desktop

Open Docker Desktop and wait for it to fully start (whale icon steady in menu bar).

### 2. Start Infrastructure

```bash
cd infra
docker-compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379

### 3. Install Dependencies

```bash
cd "/path/to/Rail Gun"
pnpm install
```

### 4. Build Shared Package

```bash
pnpm --filter @railgun/shared build
```

### 5. Configure API Environment

```bash
cd services/api
cp .env.example .env
```

The defaults work for local development:
- Database: `localhost:5432`, user `railgun`, password `railgun_dev_password`
- Redis: `localhost:6379`
- JWT Secret: `your-super-secret-jwt-key-change-in-production`

### 6. Run Migrations

```bash
cd services/api
pnpm migration:run
```

### 7. Start Development

**Option A: All services at once**
```bash
pnpm dev
```

**Option B: Individual services**
```bash
# Terminal 1 - API
cd services/api && pnpm dev

# Terminal 2 - Desktop
cd apps/desktop && pnpm dev
```

### 8. Access the App

- **Desktop App**: Opens automatically (Electron)
- **API**: http://localhost:3001
- **Health Check**: http://localhost:3001/api/v1/health

---

## Building for Distribution

### Build for macOS

```bash
cd apps/desktop
pnpm build:mac
```

**Output:**
- `release/Rail Gun-0.1.0.dmg` - Installer
- `release/Rail Gun-0.1.0-mac.zip` - Zip archive

### Build for Windows

```bash
cd apps/desktop
pnpm build:win
```

**Output:**
- `release/Rail Gun-0.1.0-win-x64.exe` - Installer

### Build for Linux

```bash
cd apps/desktop
pnpm build:linux
```

**Output:**
- `release/Rail Gun-0.1.0.AppImage`
- `release/Rail Gun-0.1.0.deb`
- `release/Rail Gun-0.1.0.rpm`

### Generate Checksums

```bash
cd apps/desktop/release
shasum -a 256 *.dmg *.exe *.zip *.AppImage > SHA256SUMS.txt
```

---

## Sharing with Friends

### Option 1: Direct Share (Fastest)

Share the DMG file directly via AirDrop, Google Drive, Dropbox, or WeTransfer:

```
apps/desktop/release/Rail Gun-0.1.0.dmg
```

**First launch on macOS (unsigned app):**
1. Right-click the app → "Open"
2. Click "Open" on the security dialog

### Option 2: GitHub Release

```bash
# Create repo (if needed)
gh repo create railgun --private --source=. --push

# Create release
gh release create v0.1.0 \
  "apps/desktop/release/Rail Gun-0.1.0.dmg" \
  "apps/desktop/release/Rail Gun-0.1.0-mac.zip" \
  "apps/desktop/release/SHA256SUMS.txt" \
  --title "Rail Gun v0.1.0" \
  --notes "Initial release"
```

### ⚠️ Backend Required

The desktop app is just a client. For it to work, friends need to connect to a backend server:

**Option A: You host locally + ngrok**
```bash
# Start backend
cd infra && docker-compose up -d
pnpm dev:api

# Expose to internet
ngrok http 3001
```

Share the ngrok URL with friends.

**Option B: Deploy to cloud**
See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment options.

---

## Troubleshooting

### "Cannot connect to Docker daemon"
→ Start Docker Desktop application

### "ECONNREFUSED localhost:5432"
→ Run `docker-compose up -d` in the `infra/` directory

### "ERR_CONNECTION_REFUSED localhost:3001"
→ API isn't running. Start with `cd services/api && pnpm dev`

### Desktop app won't start
→ Check if port 5173 is available:
```bash
lsof -ti:5173 | xargs kill -9
```

### CSP violation for fonts
→ Restart the desktop app (already fixed in electron/main.ts)

### Database connection fails
→ Verify Docker is running: `docker ps`
→ Check environment variables in `services/api/.env`

---

## Development Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all packages in development mode |
| `pnpm dev:api` | Start only the API server |
| `pnpm dev:desktop` | Start only the desktop app |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format all files |

### Migration Commands

```bash
# Generate migration from entity changes
pnpm migration:generate src/migrations/Name

# Run pending migrations
pnpm migration:run

# Revert last migration
pnpm migration:revert

# Show migration status
pnpm migration:show
```
