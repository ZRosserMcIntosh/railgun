# Production Environment Variables & Secrets

This document lists all the environment variables and secrets required to deploy Rail Gun in production.

## GitHub Actions Secrets

Set these in your repository settings under Settings > Secrets and variables > Actions.

### Code Signing (Required for trusted downloads)

#### macOS

| Secret | Description |
|--------|-------------|
| `MACOS_CERTIFICATE` | Base64-encoded .p12 certificate for code signing |
| `MACOS_CERTIFICATE_PWD` | Password for the .p12 certificate |
| `MACOS_KEYCHAIN_PWD` | Password for the temporary keychain |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_ID_PWD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

#### Windows

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERTIFICATE` | Base64-encoded .pfx certificate for code signing |
| `WINDOWS_CERTIFICATE_PWD` | Password for the .pfx certificate |

### Update Signing (Required for secure auto-updates)

| Secret | Description |
|--------|-------------|
| `RAILGUN_UPDATE_PRIVATE_KEY` | RSA private key (PEM format) for signing updates |

Generate the key pair:
```bash
# Generate private key (keep secret!)
openssl genrsa -out update-private.pem 2048

# Extract public key (distribute to clients)
openssl rsa -in update-private.pem -pubout -out update-public.pem

# Set the private key content as RAILGUN_UPDATE_PRIVATE_KEY secret
cat update-private.pem
```

### CDN/Manifest Hosting (Choose one)

#### Option 1: AWS S3

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key |
| `AWS_REGION` | AWS region (default: us-east-1) |
| `AWS_S3_BUCKET` | S3 bucket name (default: update.railgun.app) |

#### Option 2: Cloudflare R2

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with R2 write access |

#### Option 3: GitHub Releases (Default)

No additional secrets required - manifests are uploaded to GitHub Releases automatically.

### Notifications (Optional)

| Secret | Description |
|--------|-------------|
| `SLACK_WEBHOOK` | Slack incoming webhook URL for release notifications |

---

## API Service Environment Variables

Set these in your API service deployment (Docker, Kubernetes, etc.).

### Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection URL | `postgres://user:pass@host:5432/railgun` |
| `DATABASE_HOST` | Database host (if not using URL) | `localhost` |
| `DATABASE_PORT` | Database port (if not using URL) | `5432` |
| `DATABASE_USER` | Database username (if not using URL) | `railgun` |
| `DATABASE_PASSWORD` | Database password (if not using URL) | `secret` |
| `DATABASE_NAME` | Database name (if not using URL) | `railgun` |

### Redis

| Variable | Description | Example |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |

### Authentication

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing JWTs (min 32 chars) | `your-super-secret-jwt-key-here` |
| `JWT_EXPIRY` | JWT expiration time | `15m` |
| `REFRESH_TOKEN_EXPIRY` | Refresh token expiration | `7d` |

### Billing (Stripe)

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `BILLING_REF_SECRET` | Secret for generating billing refs | `your-billing-ref-secret` |

### Security

| Variable | Description | Example |
|----------|-------------|---------|
| `CORS_ORIGINS` | Allowed CORS origins | `https://railgun.app,https://app.railgun.app` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | `60` |

### Environment

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node environment | `production` |
| `PORT` | API port | `3001` |

---

## Desktop Client Build-Time Variables

Set in `.env.production` or pass during build.

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | API base URL | `https://api.railgun.app` |
| `VITE_WS_URL` | WebSocket URL | `https://api.railgun.app` |
| `VITE_UPDATE_URL` | Update manifest URL | `https://update.railgun.app` |
| `VITE_ENV` | Environment | `production` |
| `VITE_APP_VERSION` | App version | `0.1.0` |

---

## Desktop Client Runtime Variables

Set in the user's environment or injected via Electron.

| Variable | Description | Example |
|----------|-------------|---------|
| `RAILGUN_UPDATE_URL` | Override update URL | `https://update.railgun.app` |
| `RAILGUN_UPDATE_CHANNEL` | Update channel | `stable`, `beta`, `canary` |
| `RAILGUN_UPDATE_PUBLIC_KEY` | RSA public key for update verification | (PEM content) |

---

## Web Client Environment Variables

Set in Vercel/Netlify or your hosting platform.

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Public app URL | `https://railgun.app` |
| `NEXT_PUBLIC_API_URL` | API URL | `https://api.railgun.app` |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL | `wss://api.railgun.app` |
| `NEXT_PUBLIC_APP_VERSION` | App version for downloads | `0.1.0` |

---

## Quick Start Checklist

### Minimum for CI/CD builds:

1. ✅ Set `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`, `MACOS_KEYCHAIN_PWD` for macOS signing
2. ✅ Set `APPLE_ID`, `APPLE_ID_PWD`, `APPLE_TEAM_ID` for macOS notarization
3. ✅ Set `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PWD` for Windows signing
4. ✅ Set `RAILGUN_UPDATE_PRIVATE_KEY` for update signing

### Minimum for API deployment:

1. ✅ Set `DATABASE_URL` to your PostgreSQL database
2. ✅ Set `REDIS_URL` to your Redis instance
3. ✅ Set `JWT_SECRET` (generate with `openssl rand -hex 32`)
4. ✅ Set `CORS_ORIGINS` to your frontend domains
5. ✅ Run migrations: `pnpm --filter @railgun/api migration:run`

### Minimum for web deployment:

1. ✅ Set `NEXT_PUBLIC_API_URL` to your API URL
2. ✅ Set `NEXT_PUBLIC_APP_VERSION` to current version
