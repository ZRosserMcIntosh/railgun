# Rail Gun Release & Auto-Update Guide

Guide for creating signed releases and configuring the auto-update system.

## Overview

Rail Gun uses a secure auto-update system with:
- **Signed artifacts**: All releases are cryptographically signed
- **Update channels**: stable, beta, canary
- **Phased rollout**: Gradual deployment percentages
- **Rollback protection**: Build numbers prevent downgrades
- **Kill switch**: Emergency halt capability

---

## Release Workflow

### 1. Prepare Release

Update version in `apps/desktop/package.json`:

```json
{
  "version": "1.2.0"
}
```

Update `CHANGELOG.md` with release notes.

### 2. Build Artifacts

```bash
cd apps/desktop

# Build for all platforms
pnpm run build
pnpm run build:mac
pnpm run build:win
pnpm run build:linux
```

Outputs:
- macOS: `release/Rail Gun-1.2.0-arm64.dmg`, `Rail Gun-1.2.0-x64.dmg`
- Windows: `release/Rail Gun Setup 1.2.0.exe`
- Linux: `release/Rail Gun-1.2.0.AppImage`, `rail-gun_1.2.0_amd64.deb`

### 3. Sign Artifacts

#### Generate Signing Keypair (First Time)

```bash
# Generate keypair
openssl ecparam -genkey -name prime256v1 -out release-key.pem
openssl ec -in release-key.pem -pubout -out release-key.pub

# Store private key securely (HSM, secure vault, etc.)
# Public key goes in client app
```

#### Sign Each Artifact

```bash
# Calculate SHA256
sha256sum "Rail Gun-1.2.0-arm64.dmg" > release.sha256

# Sign the hash
openssl dgst -sha256 -sign release-key.pem -out release.sig release.sha256

# Base64 encode signature
base64 release.sig > release.sig.b64
```

Or use the signing script:

```bash
./scripts/sign-release.sh 1.2.0
```

### 4. Create Update Manifest

Create `manifest.json`:

```json
{
  "version": "1.2.0",
  "channel": "stable",
  "releaseDate": "2025-12-30T12:00:00Z",
  "releaseNotes": "## What's New\\n\\n- Feature X\\n- Bug fix Y",
  "mandatory": false,
  "rolloutPercentage": 10,
  "featureFlags": {
    "dex_swap": false,
    "voip_phone": true
  },
  "killSwitch": false,
  "buildNumber": 120,
  "expiresAt": "2026-01-30T12:00:00Z",
  "artifacts": [
    {
      "platform": "darwin",
      "arch": "arm64",
      "url": "https://releases.railgun.app/1.2.0/Rail Gun-1.2.0-arm64.dmg",
      "size": 125000000,
      "sha256": "abc123...",
      "signature": "base64-signature..."
    },
    {
      "platform": "darwin",
      "arch": "x64",
      "url": "https://releases.railgun.app/1.2.0/Rail Gun-1.2.0-x64.dmg",
      "size": 128000000,
      "sha256": "def456...",
      "signature": "base64-signature..."
    },
    {
      "platform": "win32",
      "arch": "x64",
      "url": "https://releases.railgun.app/1.2.0/Rail Gun Setup 1.2.0.exe",
      "size": 95000000,
      "sha256": "ghi789...",
      "signature": "base64-signature..."
    },
    {
      "platform": "linux",
      "arch": "x64",
      "url": "https://releases.railgun.app/1.2.0/Rail Gun-1.2.0.AppImage",
      "size": 110000000,
      "sha256": "jkl012...",
      "signature": "base64-signature..."
    }
  ]
}
```

### 5. Sign Manifest

```bash
# Sign the manifest itself
openssl dgst -sha256 -sign release-key.pem -out manifest.sig manifest.json
base64 manifest.sig > manifest.sig.b64

# Add signature to manifest (or serve separately)
```

### 6. Upload to Release Server

```bash
# Upload to CDN/release server
aws s3 cp release/ s3://releases.railgun.app/1.2.0/ --recursive
aws s3 cp manifest.json s3://releases.railgun.app/stable/manifest.json
```

### 7. Create GitHub Release

```bash
gh release create v1.2.0 \
  --title "Rail Gun v1.2.0" \
  --notes-file CHANGELOG.md \
  release/*.dmg \
  release/*.exe \
  release/*.AppImage \
  release/*.deb
```

---

## Update Channels

### Channel Configuration

| Channel | Purpose | Rollout | Auto-Update |
|---------|---------|---------|-------------|
| `stable` | Production releases | 100% | Yes |
| `beta` | Pre-release testing | 10-50% | Opt-in |
| `canary` | Nightly builds | 1-5% | Opt-in |

### User Selection

Users can switch channels in Settings:

```typescript
// In renderer
await window.electronAPI.autoUpdater.setChannel('beta');
```

### Manifest URLs

- Stable: `https://releases.railgun.app/stable/manifest.json`
- Beta: `https://releases.railgun.app/beta/manifest.json`
- Canary: `https://releases.railgun.app/canary/manifest.json`

---

## Phased Rollout

### Strategy

1. **Day 1**: 5% rollout (canary users)
2. **Day 2**: 25% rollout (if no issues)
3. **Day 3**: 50% rollout
4. **Day 5**: 100% rollout

### Implementation

Each client has a deterministic rollout percentile based on machine ID:

```typescript
const percentile = hash(machineId + ':' + featureKey) % 100;
```

Update manifest specifies `rolloutPercentage`. Client only updates if:
```
client.percentile <= manifest.rolloutPercentage
```

### Rollback

To halt a bad release:

1. Update manifest with `rolloutPercentage: 0`
2. Or set `killSwitch: true` to halt all updates

---

## Security Features

### Signature Verification

All artifacts and manifests are signed. The client verifies:

1. **Artifact hash** matches manifest
2. **Artifact signature** is valid against public key
3. **Manifest signature** (if served separately) is valid

### Rollback Protection

Build numbers are monotonically increasing. The client:

1. Stores installed `buildNumber` locally
2. Rejects any manifest with `buildNumber <= installed`
3. Logs security warning if rollback attempted

### Manifest Expiration

Each manifest has `expiresAt`. The client:

1. Checks current time against expiration
2. Rejects expired manifests
3. Forces re-fetch from server

### Kill Switch

Emergency halt:

```json
{
  "killSwitch": true
}
```

When enabled, client stops all update checks until next app restart.

---

## Client Configuration

### Environment Variables

```env
# Update server URL
UPDATE_SERVER_URL=https://releases.railgun.app

# Signing public key (PEM format, base64 encoded)
UPDATE_PUBLIC_KEY=LS0tLS1CRUdJTi...

# Update channel (stable, beta, canary)
UPDATE_CHANNEL=stable

# Check interval (ms)
UPDATE_CHECK_INTERVAL=14400000
```

### Code Configuration

In `apps/desktop/electron/auto-updater.ts`:

```typescript
const config: UpdateConfig = {
  updateServerUrl: process.env.UPDATE_SERVER_URL || 'https://releases.railgun.app',
  channel: (process.env.UPDATE_CHANNEL as UpdateChannel) || 'stable',
  publicKey: process.env.UPDATE_PUBLIC_KEY || HARDCODED_PUBLIC_KEY,
  autoCheck: true,
  checkInterval: 4 * 60 * 60 * 1000, // 4 hours
};
```

---

## Troubleshooting

### Update Not Installing

1. Check rollout percentage vs client percentile
2. Verify build number > installed
3. Check manifest hasn't expired
4. Verify signature is valid

### Signature Verification Failed

1. Ensure public key matches private key used for signing
2. Check for corruption in artifact download
3. Verify signature was created correctly

### Rollback Blocked

This is intentional security behavior. To downgrade:

1. Users must manually download and install older version
2. This clears the build number check

---

## Release Checklist

- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated
- [ ] All platforms built successfully
- [ ] Artifacts signed
- [ ] Manifest created with correct build number
- [ ] Manifest signed
- [ ] Uploaded to release server
- [ ] GitHub release created
- [ ] Tested on each platform
- [ ] Rollout started (5% initially)
- [ ] Monitoring dashboards checked
