# Secure Auto-Update & Analytics System

## Overview

Rail Gun implements a secure, privacy-first system for:
1. **Signed Auto-Updates** - Cryptographically verified updates with phased rollout
2. **Usage Analytics** - Privacy-preserving telemetry with user consent
3. **Feature Flags** - Remote configuration and kill switches
4. **Rollout Health Monitoring** - Automatic halt on degraded metrics

---

## 1. Auto-Update System

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub Actions │────▶│  Signed Artifacts │────▶│   CDN/GitHub    │
│    (Build CI)   │     │  + Manifest       │     │   Releases      │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                              ┌────────────────────────────┘
                              ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Desktop Client │────▶│  Auto-Updater    │────▶│  Verify & Apply │
│                 │     │  (Check/Download)│     │  Update         │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Security Model

1. **Artifact Signing** (Sigstore/cosign)
   - All artifacts are signed using keyless signing with OIDC
   - Signatures tied to GitHub Actions workflow identity
   - Verification before installation

2. **Checksum Verification**
   - SHA-256 checksums for all artifacts
   - Checksum verified after download, before installation
   - Protects against MITM and corruption

3. **Update Manifest**
   - JSON manifest with version, checksums, signatures
   - Channel-specific (stable/beta/canary)
   - Rollout percentage for phased releases

### Update Channels

| Channel | Purpose | Rollout | Stability |
|---------|---------|---------|-----------|
| `stable` | Production users | Gradual (10% → 100%) | Fully tested |
| `beta` | Opt-in beta testers | 100% immediate | Feature complete |
| `canary` | Internal testing | 100% immediate | May have issues |

### Rollout Strategy

1. **Initial Release**: 10% of stable users
2. **Health Check**: Monitor error/crash rates for 24h
3. **Expansion**: Increase to 25% → 50% → 100%
4. **Automatic Halt**: If error rate > 5% or crash rate > 1%

### Usage

```typescript
// In Electron main process
import { initAutoUpdater } from './auto-updater';

const updater = initAutoUpdater({
  channel: 'stable',
  autoCheck: true,
  checkInterval: 4 * 60 * 60 * 1000, // 4 hours
});

updater.startAutoCheck();

// Manual check
await updater.checkForUpdates();

// Download and install
await updater.downloadUpdate();
await updater.installUpdate();
```

### CI/CD Workflow

The release workflow (`.github/workflows/release.yml`) handles:

1. **Build**: Create artifacts for all platforms
2. **Sign**: Sign with macOS/Windows code signing + Sigstore
3. **Manifest**: Generate update manifest with checksums/signatures
4. **Publish**: Upload to GitHub Releases
5. **Deploy**: Push manifest to CDN

Trigger a release:
```bash
# Via git tag
git tag v0.2.0
git push origin v0.2.0

# Or manually in GitHub Actions
# Workflow dispatch with version/channel/rollout inputs
```

---

## 2. Usage Analytics

### Privacy Principles

1. **No PII**: No names, emails, or identifiable data
2. **Pseudonymized IDs**: Machine IDs are hashed
3. **Consent Required**: Users can opt out
4. **Sampling**: Only 10% of users tracked in production
5. **Minimal Retention**: 90 days for events, 1 year for aggregates

### Event Schema

```typescript
interface AnalyticsEvent {
  name: string;           // e.g., 'message_sent'
  category: EventCategory;
  userId: string;         // Hashed machine ID
  sessionId: string;
  timestamp: string;      // ISO 8601
  appVersion: string;
  platform: string;
  arch: string;
  channel: string;
  properties?: Record<string, string | number | boolean>;
  duration?: number;      // For timed events
  sequence: number;       // Event order in session
}
```

### Tracked Metrics

| Metric | Description | Calculation |
|--------|-------------|-------------|
| DAU | Daily Active Users | Unique users per day |
| WAU | Weekly Active Users | Unique users per week |
| MAU | Monthly Active Users | Unique users per month |
| Session Duration | Time spent in app | session_end - session_start |
| Feature Usage | Feature adoption | Events per feature |
| Retention | Return rate | Cohort analysis |

### Tracked Events

```typescript
// Session lifecycle
session_start
session_heartbeat  // Every 60s
session_end

// Navigation
screen_view { screen_name: string }

// Core features
message_sent { conversation_type: 'direct' | 'group' }
conversation_opened
contact_added

// Updates
update_checked
update_available { version: string }
update_downloaded
update_installed

// Errors
error { error_type, error_message }
```

### Client Usage

```typescript
// React component
import { useScreenTracking, useFeatureTracking, Events } from '@/lib/analytics';

function ChatScreen() {
  // Track screen view on mount
  useScreenTracking('chat');
  
  // Track feature usage
  const { trackUsage } = useFeatureTracking('voice_messages');
  
  const sendMessage = async () => {
    await api.sendMessage(content);
    getAnalytics().track(Events.MESSAGE_SENT, { 
      conversation_type: 'direct' 
    });
  };
  
  return <div>...</div>;
}
```

### Backend Endpoints

```bash
# Receive events
POST /analytics/events
Content-Type: application/json
{ "events": [...] }

# Get DAU
GET /analytics/dau?date=2024-12-27

# Get session metrics
GET /analytics/sessions?date=2024-12-27

# Get feature usage
GET /analytics/features?name=voice_messages

# Get retention cohort
GET /analytics/retention?cohort=2024-12-01&days=30
```

---

## 3. Feature Flags

### Remote Configuration

Feature flags allow:
- Gradual feature rollout
- A/B testing
- Emergency kill switches
- Maintenance windows

### Config Structure

```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-12-27T00:00:00Z",
  "emergencyKillSwitch": false,
  "emergencyMessage": null,
  "flags": {
    "voice_messages": {
      "key": "voice_messages",
      "enabled": true,
      "rolloutPercentage": 50,
      "minVersion": "0.2.0"
    },
    "reactions": {
      "enabled": false,
      "description": "Message reactions feature"
    }
  },
  "announcements": [
    {
      "id": "maintenance-2024-12-28",
      "type": "warning",
      "title": "Scheduled Maintenance",
      "message": "Service will be unavailable Dec 28, 2-4am UTC",
      "dismissible": true,
      "showOnce": true
    }
  ],
  "maintenance": {
    "active": false,
    "message": "We're performing maintenance",
    "startTime": "2024-12-28T02:00:00Z",
    "endTime": "2024-12-28T04:00:00Z",
    "allowReadOnly": true
  }
}
```

### Client Usage

```typescript
// Check feature flag
const isEnabled = await window.electronAPI.featureFlags.get('voice_messages');

// Get all flags
const flags = await window.electronAPI.featureFlags.getAll();

// Check for announcements
const announcements = await window.electronAPI.featureFlags.getAnnouncements();

// Check maintenance mode
const maintenance = await window.electronAPI.featureFlags.getMaintenance();

// Emergency kill switch
const { active, message } = await window.electronAPI.featureFlags.isKillSwitchActive();
```

---

## 4. Rollout Health Monitoring

### Health Metrics

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error Rate | > 5% | Automatic halt |
| Crash Rate | > 1% | Automatic halt |
| Adoption Rate | < expected | Alert |

### Health Reports

Clients periodically report:
```typescript
{
  version: "0.2.0",
  channel: "stable",
  platform: "darwin",
  arch: "arm64",
  machineId: "hashed-id",
  errors: 0,
  crashes: 0,
  timestamp: "2024-12-27T12:00:00Z"
}
```

### Rollout Status API

```bash
# Get rollout status
GET /analytics/rollout-status?version=0.2.0

# Response
{
  "version": "0.2.0",
  "channel": "stable",
  "rolloutPercentage": 25,
  "status": "active",
  "totalInstalls": 1250,
  "errorRate": 0.8,
  "crashRate": 0.1,
  "healthScore": 96
}
```

### Automatic Actions

1. **Halt**: Rollout paused, users receive previous stable version
2. **Alert**: Notification sent to ops (Slack/PagerDuty)
3. **Rollback**: Optional manual rollback to previous version

---

## 5. Configuration

### Environment Variables

```bash
# Update Server
RAILGUN_UPDATE_URL=https://update.railgun.app
RAILGUN_UPDATE_CHANNEL=stable
RAILGUN_UPDATE_PUBLIC_KEY=<base64-pem>

# Analytics
RAILGUN_ANALYTICS_URL=https://analytics.railgun.app

# Remote Config
RAILGUN_CONFIG_URL=https://config.railgun.app
```

### Secrets Required (GitHub Actions)

```yaml
# Code Signing
MACOS_CERTIFICATE         # Base64 .p12 file
MACOS_CERTIFICATE_PWD     # Certificate password
MACOS_KEYCHAIN_PWD        # Temporary keychain password
APPLE_ID                  # For notarization
APPLE_ID_PWD              # App-specific password
APPLE_TEAM_ID             # Team ID

WINDOWS_CERTIFICATE       # Base64 .pfx file
WINDOWS_CERTIFICATE_PWD   # Certificate password

# Optional
SLACK_WEBHOOK             # Release notifications
```

---

## 6. Development

### Testing Auto-Updates Locally

1. Build a test release:
   ```bash
   cd apps/desktop
   pnpm build:mac  # or build:win, build:linux
   ```

2. Create a mock manifest:
   ```bash
   echo '{
     "version": "0.2.0",
     "channel": "canary",
     "artifacts": [...]
   }' > manifest.json
   ```

3. Serve locally:
   ```bash
   npx serve release
   ```

4. Point app to local server:
   ```bash
   RAILGUN_UPDATE_URL=http://localhost:3000 pnpm electron:dev
   ```

### Testing Analytics

1. Enable debug mode:
   ```typescript
   initAnalytics({ debug: true, sampleRate: 1.0 });
   ```

2. Watch events in console:
   ```
   [Analytics] session_start
   [Analytics] screen_view { screen_name: 'home' }
   [Analytics] message_sent { conversation_type: 'direct' }
   ```

3. Check API:
   ```bash
   curl http://localhost:3001/analytics/dau
   ```

---

## 7. Compliance

### Data Collected

| Data | Stored | Purpose |
|------|--------|---------|
| Hashed Machine ID | Yes (90d) | Unique user counting |
| Session ID | Yes (90d) | Session tracking |
| Event Names | Yes (90d) | Feature usage |
| App Version | Yes (90d) | Version adoption |
| Platform | Yes (90d) | Platform breakdown |
| Timestamps | Yes (90d) | Time-series analysis |

### Data NOT Collected

- ❌ Personal names or emails
- ❌ Message content
- ❌ Contact lists
- ❌ IP addresses (not logged)
- ❌ Device identifiers
- ❌ Location data

### User Controls

- Opt-out via Settings → Privacy
- Data deletion available upon request
- Consent stored locally

---

## 8. Monitoring & Alerts

### Recommended Setup

1. **Grafana Dashboard** for analytics metrics
2. **PagerDuty/Slack** for rollout alerts
3. **Sentry** for error tracking (optional)

### Key Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Rollout Halted | Auto-halt triggered | Critical |
| High Error Rate | > 5% for 15min | Warning |
| Low Adoption | < 10% after 48h | Info |
| Analytics Backlog | Queue > 10k | Warning |

---

## 9. Future Enhancements

- [ ] A/B testing framework integration
- [ ] Warehouse export (BigQuery/Snowflake)
- [ ] Delta updates (faster downloads)
- [ ] P2P update distribution
- [ ] Real-time dashboards
