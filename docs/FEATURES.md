# Rail Gun Features

Last updated: December 28, 2025

Documentation for all Rail Gun features including messaging, voice/video, communities, and more.

---

## Table of Contents

1. [Direct Messages](#direct-messages)
2. [Communities & Channels](#communities--channels)
3. [Voice & Video Chat](#voice--video-chat)
4. [Self-DM (Saved Messages)](#self-dm-saved-messages)
5. [User Discovery](#user-discovery)
6. [QR Authentication](#qr-authentication)

---

## Direct Messages

### Overview

Private 1:1 encrypted conversations between users.

### Features

- **End-to-End Encryption**: All messages encrypted with Signal Protocol
- **Real-Time Delivery**: WebSocket-based instant messaging
- **Typing Indicators**: See when the other person is typing
- **Read Receipts**: Message delivery and read status
- **Message History**: Encrypted local storage with pagination

### API Endpoints

```
POST   /api/v1/dms              # Start a DM with a user
GET    /api/v1/dms              # List all DM conversations
GET    /api/v1/dms/:id/messages # Get message history
```

### WebSocket Events

```typescript
// Join a DM room
socket.emit('dm:join', { conversationId });

// Send a message
socket.emit('message:send', { 
  conversationId, 
  encryptedContent,
  type: 'DM'
});

// Typing indicator
socket.emit('typing', { conversationId, isTyping: true });
```

---

## Communities & Channels

### Overview

Discord-like communities with multiple text and voice channels.

### Features

- **Multiple Channels**: Organize conversations by topic
- **Role-Based Permissions**: Owner, Admin, Moderator, Member
- **Invite Codes**: Share invite links for new members
- **Channel Management**: Create, edit, delete channels

### Community Settings

Access via **⚙️ Settings** icon next to community name.

#### Overview Tab
- Community icon (512x512px recommended)
- Name and description
- Invite code management

#### Roles Tab

**Default Roles:**
| Role | Color | Permissions |
|------|-------|-------------|
| Owner | Red | Full administrator |
| Admin | Orange | Manage community, channels, roles |
| Moderator | Green | Manage messages, kick members |
| Member | Gray | Basic read/write |

**Permissions:**
- `ADMINISTRATOR` - Full access
- `MANAGE_COMMUNITY` - Edit settings
- `MANAGE_CHANNELS` - Create/edit/delete channels
- `MANAGE_ROLES` - Manage role assignments
- `KICK_MEMBERS` - Remove members
- `BAN_MEMBERS` - Permanent bans
- `MANAGE_MESSAGES` - Delete others' messages

#### Members Tab
- View all members with roles
- Assign/remove roles
- Kick members

#### Channels Tab
- List all channels
- Edit channel settings
- Create new channels

---

## Voice & Video Chat

### Overview

Real-time voice and video communication in DMs and channels.

### Free vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| Voice in DMs/channels | ✅ Unlimited | ✅ Unlimited |
| Max participants | 8 | 25 |
| Audio quality | 32 kbps | 64 kbps |
| Video calling | ❌ | ✅ 720p+ |
| Screen sharing | ❌ | ✅ |
| Simultaneous video streams | 4 | 6 |

### Technical Stack

- **SFU**: mediasoup (same as Discord)
- **Transport**: WebRTC
- **Codecs**: Opus (audio), VP8/VP9 (video)

### Audio Processing Pipeline

1. Browser AEC/NS/AGC (echo cancellation, noise suppression)
2. Optional RNNoise (deep learning noise suppression)
3. Input limiter (-3 dBFS)
4. Voice activity detection (VAD)
5. Auto-leveling (-18 dBFS normalization)

### Audio Constraints

```typescript
{
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  sampleRate: { ideal: 48000 },
  channelCount: { exact: 1 },  // Force mono
}
```

### Architecture Flow

```
Your App                      SFU Server                    Other Person
   │                               │                              │
   │  1. Join voice request        │                              │
   │  ─────────────────────────►   │                              │
   │                               │                              │
   │  2. Permissions + transport   │                              │
   │  ◄─────────────────────────   │                              │
   │                               │                              │
   │  3. WebRTC handshake          │                              │
   │  ◄────────────────────────►   │                              │
   │                               │                              │
   │  4. Audio/video streams       │   Forwarded streams          │
   │  ─────────────────────────►   ├─────────────────────────────►│
```

All calls go through the SFU (even 1:1) for privacy - prevents IP leakage.

---

## Self-DM (Saved Messages)

### Overview

Private space for notes, reminders, and saved content - similar to Telegram's "Saved Messages".

### Access

1. Click "New DM" button (or magnifying glass)
2. Click **💾 Message Yourself (Saved Messages)** at top

### Use Cases

- **Personal Notes**: Quick scratchpad for thoughts
- **Reminders**: Send yourself messages
- **Link Storage**: Save important URLs
- **Testing**: Test message formatting
- **Drafts**: Draft messages before sending

### UI Indicators

- **Sidebar**: Purple circle with 💾 icon
- **Label**: "[Your Name] (You)"
- **Chat Header**: Purple "Saved Messages" badge
- **Conversation ID**: `self:userId` format

---

## User Discovery

### Overview

Find and connect with other Rail Gun users.

### Search Methods

1. **Username Prefix Search**: Type partial username
2. **Exact Username Lookup**: Full username match

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| User search | 10 requests | 1 minute |
| Exact lookup | 30 requests | 1 minute |

Prevents enumeration attacks while allowing normal usage.

### API Endpoints

```
GET /api/v1/users/search?query=alice       # Prefix search
GET /api/v1/users/by-username/:username    # Exact lookup
```

### UI Component

**StartDmModal** (`apps/desktop/src/components/StartDmModal.tsx`):
- Real-time search as you type
- User avatars and display names
- One-click to start DM

---

## QR Authentication

### Overview

Log into the web app by scanning a QR code with your mobile device.

### Flow

```
Web Browser                    API Server                    Mobile App
     │                              │                              │
     │  1. Create session           │                              │
     │  ────────────────────────►   │                              │
     │                              │                              │
     │  2. Session ID + secret      │                              │
     │  ◄────────────────────────   │                              │
     │                              │                              │
     │  3. Display QR code          │                              │
     │  (contains session ID)       │                              │
     │                              │                              │
     │                              │  4. Scan QR, complete auth   │
     │                              │  ◄────────────────────────────│
     │                              │                              │
     │  5. Poll/WS: session done    │                              │
     │  ◄────────────────────────   │                              │
     │                              │                              │
     │  6. Exchange for JWT         │                              │
     │  ────────────────────────►   │                              │
     │                              │                              │
     │  7. Access token             │                              │
     │  ◄────────────────────────   │                              │
```

### Session States

| State | Description |
|-------|-------------|
| `PENDING` | QR displayed, waiting for scan |
| `SCANNED` | Mobile scanned but not authenticated |
| `COMPLETED` | Auth successful, ready to exchange |
| `EXPIRED` | 5-minute TTL exceeded |
| `CANCELLED` | User cancelled |

### API Endpoints

```
POST   /auth/sessions              # Create QR session
GET    /auth/sessions/:id          # Poll session status
POST   /auth/sessions/:id/scan     # Mark as scanned
POST   /auth/sessions/:id/complete # Mobile completes auth
POST   /auth/sessions/:id/exchange # Exchange for JWT
POST   /auth/sessions/:id/cancel   # Cancel session
```

### WebSocket (Real-Time Updates)

```typescript
// Namespace: /auth
socket.on('session:scanned', ({ sessionId }) => ...);
socket.on('session:completed', ({ sessionId }) => ...);
socket.on('session:expired', ({ sessionId }) => ...);
```

### React Hook

```typescript
import { useQRAuth } from '@/lib/qr-auth/useQRAuth';

const { sessionId, status, qrData, error, retry } = useQRAuth();
```
