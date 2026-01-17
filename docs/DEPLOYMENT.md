# Rail Gun Deployment Guide

Last updated: January 17, 2026

Complete guide for deploying Rail Gun to production, including backend hosting, release management, and distribution.

---

## Table of Contents

1. [Deployment Overview](#deployment-overview)
2. [Backend Deployment (Fly.io)](#backend-deployment-flyio)
3. [Database Setup](#database-setup)
4. [Release Process](#release-process)
5. [Website Deployment](#website-deployment)
6. [Environment Variables](#environment-variables)
7. [Monitoring](#monitoring)

---

## Deployment Overview

### Components to Deploy

| Component | Technology | Hosting |
|-----------|------------|---------|
| **API Server** | NestJS | Fly.io |
| **Database** | PostgreSQL 15+ | Fly Postgres or Supabase |
| **Cache** | Redis 7+ | Upstash Redis (via Fly.io) |
| **Marketing Site** | Next.js | Vercel |
| **Desktop Installers** | Electron | GitHub Releases |

### Production Checklist

- [ ] Backend API deployed on Fly.io
- [ ] PostgreSQL database attached
- [ ] Redis for sessions/rate limiting  
- [ ] GitHub release with signed installers
- [ ] Website pointing to real download URLs
- [ ] Environment variables configured
- [ ] Health monitoring enabled

---

## Backend Deployment (Fly.io)

Fly.io is the primary deployment target for Rail Gun.

### Prerequisites

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login
```

### Deploy API

```bash
cd services/api

# First time: Launch app
flyctl launch --name railgun-api

# Subsequent deploys
flyctl deploy
```

### Create PostgreSQL Database

```bash
# Create managed Postgres
flyctl postgres create --name railgun-db --region iad

# Attach to app
flyctl postgres attach railgun-db --app railgun-api
```

### Create Redis (Upstash)

```bash
# Create Upstash Redis via Fly.io
flyctl redis create --name railgun-redis

# Or use external Upstash account for more control
```

### Set Secrets

```bash
flyctl secrets set \
  JWT_SECRET="$(openssl rand -base64 64)" \
  RECOVERY_CODE_SECRET="$(openssl rand -base64 32)" \
  CORS_ORIGINS="https://railgun.app,https://www.railgun.app" \
  --app railgun-api
```

### Useful Commands

```bash
flyctl logs -a railgun-api      # View logs
flyctl status -a railgun-api    # Check status
flyctl ssh console -a railgun-api # SSH into container
flyctl secrets list -a railgun-api # List secrets
flyctl scale count 2 -a railgun-api # Scale to 2 instances
```

### Quick Deploy Script

Use the provided deploy script:

```bash
cd infra
./deploy.sh api
```

---

## Database Setup

### Fly Postgres (Recommended)

Fly Postgres provides managed PostgreSQL with automatic backups.

```bash
# Create cluster
flyctl postgres create --name railgun-db --region iad

# Connect (for debugging)
flyctl postgres connect -a railgun-db

# Run migrations
flyctl ssh console -a railgun-api -C "pnpm migration:run"
```

### Alternative: Supabase

For a fully managed solution with dashboard:

1. Create project at supabase.com
2. Get connection string from Settings > Database
3. Set `DATABASE_URL` secret in Fly.io

---

## Release Process
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3001
CMD ["pnpm", "start:prod"]
```

```bash
docker build -t railgun-api ./services/api
docker run -p 3001:3001 --env-file .env railgun-api
```

---

## Release Process

### Release Artifacts

| Platform | File | Description |
|----------|------|-------------|
| macOS (Universal) | `Rail-Gun-{version}-mac-universal.dmg` | Signed & notarized |
| macOS (Intel) | `Rail-Gun-{version}-mac-x64.dmg` | Intel Macs |
| macOS (Apple Silicon) | `Rail-Gun-{version}-mac-arm64.dmg` | M1/M2 Macs |
| Windows | `Rail-Gun-{version}-win-x64.exe` | Signed NSIS installer |
| Linux | `Rail-Gun-{version}-linux-x86_64.AppImage` | Portable |
| Linux | `Rail-Gun-{version}-linux-amd64.deb` | Debian/Ubuntu |

### Build All Platforms

```bash
cd apps/desktop

# Build for each platform
pnpm build:mac
pnpm build:win
pnpm build:linux

# Generate checksums
cd release
shasum -a 256 *.dmg *.exe *.zip *.AppImage *.deb > SHA256SUMS.txt
```

### Create GitHub Release

```bash
# Using GitHub CLI
gh release create v0.1.0 \
  "release/Rail Gun-0.1.0.dmg" \
  "release/Rail Gun-0.1.0-mac.zip" \
  "release/Rail Gun-0.1.0-win-x64.exe" \
  "release/Rail Gun-0.1.0-linux-x86_64.AppImage" \
  "release/SHA256SUMS.txt" \
  --title "Rail Gun v0.1.0" \
  --notes "Initial release"
```

### Code Signing (Production)

#### macOS Signing & Notarization

Required GitHub Secrets:
```
MACOS_CERTIFICATE          # Base64-encoded .p12 certificate
MACOS_CERTIFICATE_PWD      # Certificate password
MACOS_KEYCHAIN_PWD         # Temporary keychain password
APPLE_ID                   # Apple ID email
APPLE_ID_PWD               # App-specific password
APPLE_TEAM_ID              # Developer Team ID
```

#### Windows Signing

Required GitHub Secrets:
```
WINDOWS_CERTIFICATE        # Base64-encoded .pfx certificate
WINDOWS_CERTIFICATE_PWD    # Certificate password
```

### Verifying Downloads

```bash
# Download checksum file
curl -LO https://github.com/user/railgun/releases/download/v0.1.0/SHA256SUMS.txt

# Verify checksum
sha256sum -c SHA256SUMS.txt --ignore-missing

# Verify macOS code signature
codesign -dv --verbose=4 "/Applications/Rail Gun.app"
spctl -a -vvv -t install "/Applications/Rail Gun.app"
```

---

## Website Deployment

### Marketing Site (railgun-site)

The website is configured to deploy to Vercel:

```bash
cd railgun-site
vercel --prod
```

### Configuration

Update `railgun-site/src/lib/config.ts`:

```typescript
const GITHUB_REPO = 'YourUsername/railgun';  // Your repo
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
```

### Environment Variables

Set in Vercel dashboard:
```
NEXT_PUBLIC_APP_VERSION=0.1.0
NEXT_PUBLIC_SITE_URL=https://railgun.app
NEXT_PUBLIC_WEB_APP_URL=https://app.railgun.app
NEXT_PUBLIC_GITHUB_URL=https://github.com/YourUsername/railgun
```

---

## Environment Variables

### API Service (Production)

```bash
# Core
NODE_ENV=production
PORT=3001

# Database (use connection URL for cloud DBs)
DATABASE_URL=postgresql://user:pass@host:5432/railgun?sslmode=require

# Redis
REDIS_URL=redis://default:password@host:6379

# Authentication
JWT_SECRET=<generate with: openssl rand -base64 64>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Stripe (for Pro subscriptions)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...

# Optional
CORS_ORIGIN=https://app.railgun.app
LOG_LEVEL=info
```

### Desktop App

Update `apps/desktop/src/lib/env.ts` before building:

```typescript
export const API_URL = 'https://api.railgun.app';  // Your production API
export const WS_URL = 'wss://api.railgun.app';
```

---

## Secure Hosting Options

### Privacy-Focused Providers

For maximum privacy/censorship resistance:

| Provider | Location | Why |
|----------|----------|-----|
| **1984 Hosting** | Iceland | Strongest privacy laws |
| **FlokiNET** | Iceland/Romania | Bulletproof, crypto accepted |
| **Njalla** | Nevis | Anonymous domain registration |
| **Bahnhof** | Sweden | Underground bunker, hosted WikiLeaks |

### Jurisdiction Recommendations

**Best privacy jurisdictions:**
- Iceland (strongest press freedom)
- Switzerland (strong banking privacy)
- Panama (no data retention)
- Romania (weak enforcement)

**Avoid:**
- Five Eyes (US, UK, Canada, Australia, NZ)
- Fourteen Eyes (adds Germany, France, etc.)

### Multi-Region Setup

For takedown resilience:
1. Primary API in privacy-friendly jurisdiction
2. CDN for static assets (Cloudflare)
3. Database in separate jurisdiction
4. Multiple bootstrap nodes across regions

---

## Auto-Update System

### Architecture

```
GitHub Actions → Signed Artifacts → CDN/GitHub Releases → Desktop Client
```

### Update Channels

| Channel | Rollout | Audience |
|---------|---------|----------|
| `stable` | Gradual (10% → 100%) | All users |
| `beta` | 100% immediate | Opt-in testers |
| `canary` | 100% immediate | Internal |

### Rollout Strategy

1. Release to 10% of stable users
2. Monitor error/crash rates for 24h
3. Expand to 25% → 50% → 100%
4. Auto-halt if error rate > 5% or crash rate > 1%

### Update Signing

Generate signing key pair:
```bash
# Private key (keep secret!)
openssl genrsa -out update-private.pem 2048

# Public key (embed in client)
openssl rsa -in update-private.pem -pubout -out update-public.pem
```

Set `RAILGUN_UPDATE_PRIVATE_KEY` in GitHub Actions secrets.

### Rollback Protection

- Build numbers prevent downgrade attacks
- Manifest expiry (7-day validity)
- Minimum version enforcement
