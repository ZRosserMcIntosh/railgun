# Release Process

This document describes how Rail Gun releases are built, signed, and distributed.

## Release Artifacts

Each release includes the following artifacts:

| Platform | File | Description |
| -------- | ---- | ----------- |
| macOS (Intel) | `Rail-Gun-{version}-mac-x64.dmg` | Signed & notarized disk image |
| macOS (Apple Silicon) | `Rail-Gun-{version}-mac-arm64.dmg` | Signed & notarized disk image |
| macOS (Universal) | `Rail-Gun-{version}-mac-universal.dmg` | Universal binary for all Macs |
| Windows | `Rail-Gun-{version}-win-x64.exe` | Signed NSIS installer |
| Windows (Portable) | `Rail-Gun-{version}-win-x64-portable.exe` | Portable executable |
| Linux (Debian/Ubuntu) | `Rail-Gun-{version}-linux-amd64.deb` | Debian package |
| Linux (Red Hat/Fedora) | `Rail-Gun-{version}-linux-x86_64.rpm` | RPM package |
| Linux (AppImage) | `Rail-Gun-{version}-linux-x86_64.AppImage` | Portable AppImage |

## Checksums & Signatures

Every release includes:

- `SHA256SUMS.txt` - SHA256 checksums for all artifacts
- `SHA256SUMS.txt.asc` - GPG detached signature of the checksums file

### GPG Signing Key

```
Key ID: [TO BE GENERATED]
Fingerprint: [TO BE GENERATED]
```

The signing key is available at:
- GitHub: https://github.com/[org]/rail-gun/blob/main/RELEASE_KEY.pub
- Keyserver: keys.openpgp.org

## Verifying Downloads

### Step 1: Download the Files

Download both the installer for your platform and the checksum files:
- Your platform's installer (`.dmg`, `.exe`, `.deb`, etc.)
- `SHA256SUMS.txt`
- `SHA256SUMS.txt.asc`

### Step 2: Verify the GPG Signature

```bash
# Import the signing key (first time only)
gpg --keyserver keys.openpgp.org --recv-keys [KEY_ID]

# Verify the signature
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
```

You should see: `Good signature from "Rail Gun Release Signing Key"`

### Step 3: Verify the Checksum

**macOS / Linux:**
```bash
# Verify checksum matches
sha256sum -c SHA256SUMS.txt --ignore-missing
```

**Windows (PowerShell):**
```powershell
# Calculate hash
$hash = (Get-FileHash -Algorithm SHA256 "Rail-Gun-{version}-win-x64.exe").Hash.ToLower()

# Compare with expected (from SHA256SUMS.txt)
$expected = "expected_hash_from_file"
if ($hash -eq $expected) { "✓ Checksum verified" } else { "✗ CHECKSUM MISMATCH" }
```

### Step 4: Verify Code Signing (Platform-Specific)

**macOS:**
```bash
# Verify Apple code signature
codesign -dv --verbose=4 "/Applications/Rail Gun.app"

# Verify notarization
spctl -a -vvv -t install "/Applications/Rail Gun.app"
```

Expected output should show:
- `Authority=Developer ID Application: [Developer Name]`
- `source=Notarized Developer ID`

**Windows:**
```powershell
# View code signature
Get-AuthenticodeSignature "Rail-Gun-{version}-win-x64.exe" | Format-List
```

Should show `Valid` status with our certificate.

## Build Process

### Prerequisites

Releases are built in a clean CI environment with:
- Node.js LTS (pinned version in `.nvmrc`)
- pnpm (version in `package.json`)
- Electron Builder
- Platform-specific signing tools

### Build Commands

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Run tests
pnpm test

# Build for production
pnpm build

# Package for all platforms (CI only)
pnpm package:all
```

### Reproducible Builds

We aim for reproducible builds. To verify:

1. Clone the repository at the release tag
2. Use the same Node.js and pnpm versions
3. Run `pnpm install --frozen-lockfile`
4. Run `pnpm build`
5. Compare output hashes

Note: Due to code signing, the final signed artifacts will differ, but the unsigned build output should match.

## Signing Infrastructure

### macOS
- Apple Developer ID certificate stored in CI secrets
- Notarization via `notarytool`
- Hardened runtime enabled
- Entitlements limited to required capabilities

### Windows
- EV Code Signing Certificate
- Signed via SignTool in CI
- Timestamp from trusted TSA

### GPG
- Release signing key stored offline
- Subkey used for CI automation
- Primary key in cold storage

## Release Checklist

Before each release:

- [ ] All tests passing on CI
- [ ] CHANGELOG.md updated
- [ ] Version bumped in `package.json`
- [ ] Security dependencies updated
- [ ] No critical/high vulnerabilities in `pnpm audit`
- [ ] Release notes drafted
- [ ] Tag created and signed (`git tag -s`)

After release:

- [ ] Artifacts uploaded to GitHub Releases
- [ ] Checksums generated and signed
- [ ] Download page updated
- [ ] Release announced

## Incident Response

If a release is found to contain a security vulnerability:

1. **Immediate**: Pull affected artifacts from distribution
2. **24 hours**: Issue security advisory
3. **ASAP**: Release patched version
4. **Follow-up**: Post-mortem and process improvement

## Auto-Update

Rail Gun supports auto-updates via Electron's `autoUpdater`:

- Updates are checked on app launch and periodically
- Updates are downloaded in the background
- User is prompted to restart to apply
- Update packages are signed with the same key as releases

Users can disable auto-update in settings if preferred.

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes.

| Version | Date | Notes |
| ------- | ---- | ----- |
| 0.1.0 | 2024-XX-XX | Initial release |

---

**Questions?** Open a GitHub Discussion or see [SECURITY.md](./SECURITY.md) for security-related inquiries.
