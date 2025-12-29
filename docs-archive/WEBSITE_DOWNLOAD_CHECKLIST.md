# 🚀 Website Download Readiness Checklist

**Goal:** Enable users to download a working Rail Gun from the website.

---

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Website (`railgun-site`) | 🟡 Built | Points to non-existent GitHub releases |
| Desktop App Build | ✅ Ready | `Rail Gun-0.1.0.dmg` built locally |
| GitHub Release | ❌ Missing | No artifacts uploaded yet |
| Backend API | ❌ Not Deployed | Required for app to function |
| Checksums | ✅ Generated | `SHA256SUMS.txt` created locally |

---

## Step-by-Step: Make Downloads Work

### Step 1: Create GitHub Repository & Release (5 min)

```bash
cd "/Users/rossermcintosh/Desktop/Rail Gun"

# Initialize/push to GitHub (if not done)
gh repo create railgun --private --source=. --push

# Create the release with your built artifacts
gh release create v0.1.0 \
  "apps/desktop/release/Rail Gun-0.1.0.dmg" \
  "apps/desktop/release/Rail Gun-0.1.0-mac.zip" \
  "apps/desktop/release/SHA256SUMS.txt" \
  --title "Rail Gun v0.1.0" \
  --notes "Initial release - macOS desktop client"
```

**After this:** Download URLs on the website will work for macOS!

---

### Step 2: Deploy Backend API (Required for app to function)

The desktop app needs a backend server. Choose one:

#### Option A: Railway.app (Easiest, ~10 min)

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. New Project → Deploy from GitHub repo
3. Add **PostgreSQL** service
4. Add **Redis** service
5. Deploy the `services/api` folder
6. Set environment variables:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<generate with: openssl rand -base64 64>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

#### Option B: Render.com (Free tier)

1. Create a Web Service from your repo
2. Root directory: `services/api`
3. Build command: `pnpm install && pnpm build`
4. Start command: `pnpm start:prod`
5. Add PostgreSQL (free tier) and Redis (paid) add-ons

#### Option C: Fly.io (More control)

```bash
cd services/api
fly launch
fly postgres create
fly redis create
fly secrets set JWT_SECRET="$(openssl rand -base64 64)"
fly deploy
```

---

### Step 3: Configure Desktop App to Use Production API

Update the API URL in the desktop app config:

**File:** `apps/desktop/src/lib/env.ts`

```typescript
export const API_URL = process.env.VITE_API_URL || 'https://your-api.railway.app';
export const WS_URL = process.env.VITE_WS_URL || 'wss://your-api.railway.app';
```

Then rebuild and re-release:

```bash
cd apps/desktop
pnpm build:mac

# Update the release
gh release upload v0.1.0 "release/Rail Gun-0.1.0.dmg" --clobber
```

---

### Step 4: Update & Redeploy Website (2 min)

The website is already configured correctly! Just ensure:

1. GitHub repo is `ZRosserMcIntosh/railgun` (matches `config.ts`)
2. Release tag is `v0.1.0` (matches version)

If deploying to Vercel:

```bash
cd railgun-site
vercel --prod
```

---

## Quick Verification Checklist

After completing the steps:

- [ ] `https://github.com/ZRosserMcIntosh/railgun/releases/tag/v0.1.0` shows DMG
- [ ] Website download buttons return 200 (not 404)
- [ ] API health check: `curl https://your-api.railway.app/health`
- [ ] Download DMG → Install → App opens without crash
- [ ] App can connect to API (login/register works)

---

## Minimum Viable Path (Fastest)

If you want to share with friends TODAY:

1. **Skip the website** - share the DMG directly via AirDrop/Google Drive
2. **Run API locally** - you host, friends connect to your IP
3. **Use ngrok** for remote access:
   ```bash
   cd infra && docker-compose up -d
   pnpm dev:api
   ngrok http 3001
   ```
4. Share the ngrok URL with friends, update their app config

---

## Files That Need Real Values

| File | What to Update |
|------|----------------|
| `railgun-site/src/lib/config.ts` | `GITHUB_REPO` if different |
| `apps/desktop/src/lib/env.ts` | Production `API_URL` and `WS_URL` |
| `services/api/.env` | All production secrets |

---

## Summary

| Task | Time | Priority |
|------|------|----------|
| Push GitHub release | 5 min | 🔴 Critical |
| Deploy backend API | 15-30 min | 🔴 Critical |
| Update app with API URL | 5 min | 🔴 Critical |
| Rebuild & upload DMG | 5 min | 🔴 Critical |
| Redeploy website | 2 min | 🟡 Optional (if not on Vercel already) |

**Total time to working website downloads: ~45 minutes**
