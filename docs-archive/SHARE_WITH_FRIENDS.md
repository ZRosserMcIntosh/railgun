# 🚀 Share Rail Gun with Friends

## Quick Install (macOS)

The app is built and ready! Share the DMG directly:

**Location:** `apps/desktop/release/Rail Gun-0.1.0.dmg`

### For Your Friends (macOS)

1. **Download** the `Rail Gun-0.1.0.dmg` file (share via AirDrop, Google Drive, Dropbox, etc.)
2. **Open** the DMG file
3. **Drag** Rail Gun to Applications
4. **First launch**: Right-click the app → "Open" (bypasses Gatekeeper since it's not notarized yet)
5. Click "Open" on the security dialog

### Checksum Verification (Optional)

```bash
# Your friends can verify the file wasn't corrupted:
shasum -a 256 "Rail Gun-0.1.0.dmg"
# Should match: 46758a7a817664187cd34907e50aac20574b33a2f9e460d8cbfd0f5dc21d29e5
```

---

## ⚠️ Important: The App Needs a Backend

The desktop app is just a client. For it to actually work, you need a running backend server.

### Option A: Run Your Own Server (Development)

```bash
# Terminal 1: Start infrastructure (Postgres + Redis)
cd "/Users/rossermcintosh/Desktop/Rail Gun/infra"
docker-compose up -d

# Terminal 2: Start the API server
cd "/Users/rossermcintosh/Desktop/Rail Gun"
pnpm dev:api
```

Then configure the desktop app to connect to `http://localhost:3000`

### Option B: Host a Server for Friends

Deploy the API to a cloud provider:

1. **Render.com** (free tier available)
2. **Railway.app** (easy deployment)
3. **DigitalOcean App Platform**
4. **Fly.io**

You'll need:
- PostgreSQL database
- Redis instance
- The `services/api` service deployed

---

## 📤 Easy Sharing Options

### 1. AirDrop (Mac-to-Mac)
Just AirDrop `Rail Gun-0.1.0.dmg` directly to friends nearby.

### 2. Cloud Storage
Upload to:
- Google Drive
- Dropbox
- iCloud Drive
- WeTransfer (for one-time links)

### 3. GitHub Release (Recommended for public distribution)

```bash
# 1. Create a GitHub repo if you haven't
gh repo create railgun --private --source=. --remote=origin --push

# 2. Create a release with the artifacts
gh release create v0.1.0 \
  "apps/desktop/release/Rail Gun-0.1.0.dmg" \
  "apps/desktop/release/Rail Gun-0.1.0-mac.zip" \
  "apps/desktop/release/SHA256SUMS.txt" \
  --title "Rail Gun v0.1.0" \
  --notes "Initial release - macOS desktop client"
```

---

## 🔧 Building for Other Platforms

### Windows
```bash
cd apps/desktop
pnpm build:win
# Creates: release/Rail Gun-0.1.0-win-x64.exe
```

### Linux
```bash
cd apps/desktop
pnpm build:linux
# Creates: release/Rail-Gun-0.1.0.AppImage, .deb, .rpm
```

---

## 📋 Checklist Before Sharing

- [x] ✅ DMG built successfully
- [x] ✅ Checksums generated
- [ ] 🔲 Backend server running (required for the app to work!)
- [ ] 🔲 GitHub repo created (optional, for easy distribution)
- [ ] 🔲 GitHub release created (optional)

---

## Need a Quick Test?

Run everything locally:

```bash
# Start everything
cd "/Users/rossermcintosh/Desktop/Rail Gun"
pnpm dev

# Or step by step:
cd infra && docker-compose up -d   # Start Postgres & Redis
pnpm dev:api                        # Start backend (new terminal)
pnpm dev:desktop                    # Start desktop app (new terminal)
```

The app will open and connect to `localhost:3000`.
