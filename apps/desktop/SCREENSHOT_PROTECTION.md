# Screenshot Protection

## Setup

**Add the warning image:**

1. Save the "F*CK YOU" middle finger image as:
   ```
   apps/desktop/public/screenshot-warning.png
   ```

2. The image should be:
   - PNG format with transparency
   - Approximately 800x800px or larger
   - The glowing neon middle finger design you provided

## How It Works

### Detection
- **Keyboard Shortcuts**: Detects Cmd+Shift+3/4/5 (macOS) and Print Screen (Windows/Linux)
- **Main Process**: Electron's `before-input-event` captures screenshot attempts
- **Content Protection**: macOS 10.15+ prevents screen recording of the window

### Behavior
When a screenshot attempt is detected:
1. The entire app is covered with a full-screen overlay
2. Your warning image is displayed (glowing, animated)
3. Overlay fades out after 3 seconds
4. Screenshot captures the warning image instead of app content

### Limitations
- **Cannot fully prevent screenshots** on all platforms (OS limitation)
- **Best effort protection** - shows warning to discourage screenshots
- **Screen recording**: macOS 10.15+ blocks recording, other platforms show warning

## Testing

To test screenshot protection:

**macOS:**
```bash
# Press Cmd+Shift+4 and try to screenshot the app
```

**Windows/Linux:**
```bash
# Press Print Screen key
```

You should see the warning overlay appear immediately.

## Disabling (for development)

In browser console:
```javascript
// Import and disable
import { disableScreenshotProtection } from './lib/screenshotProtection';
disableScreenshotProtection();
```

## Production Notes

- Content protection is **enabled by default** in production builds
- Users attempting screenshots will see your warning image
- This discourages leaking sensitive conversations
- Consider adding user education about why screenshots are blocked
