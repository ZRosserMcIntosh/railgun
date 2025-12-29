# Voice & Video Chat

Last updated: December 28, 2025

This doc covers everything about voice and video in Rail Gun—how it works, what's free vs paid, how we handle privacy, and how to actually build and run the thing.

---

## What We're Building

Voice chat in DMs and channels is free for everyone. Video and screen sharing are Pro-only. The reasoning is simple: voice is table stakes, video costs us real money in bandwidth.

**Free users get:**
- Voice in DMs and channels (unlimited)
- Up to 8 people in a voice channel
- 32 kbps audio (sounds fine, not amazing)

**Pro users get:**
- Everything above, plus:
- Video calling (720p+)
- Screen sharing
- Up to 25 people in a voice channel
- 64 kbps audio (noticeably better)
- Up to 6 simultaneous video streams in a room (4 for free)

If your Pro subscription expires mid-call, video and screen share just stop. You keep talking. No drama.

---

## How It Actually Works

### The Stack

We're using **mediasoup** as our SFU (Selective Forwarding Unit). It's what Discord uses at scale, has a C++ core for performance, and gives us fine control over bitrate and codecs.

Here's the flow:

```
Your App                      Our Servers                    Other Person
─────────                     ───────────                    ────────────
   │                               │                              │
   │  1. "I want to join voice"    │                              │
   │  ─────────────────────────►   │                              │
   │                               │                              │
   │  2. Here's your permissions   │                              │
   │  ◄─────────────────────────   │                              │
   │                               │                              │
   │  3. WebRTC handshake          │                              │
   │  ◄────────────────────────►   │                              │
   │                               │                              │
   │  4. Audio/video flows         │   Audio/video flows          │
   │  ─────────────────────────►   ├─────────────────────────────►│
   │                               │                              │
```

Everything goes through our SFU. Even 1:1 DM calls. This is intentional—see the privacy section below.

### Audio Processing

When you speak, here's what happens to your audio:

1. **Browser's built-in AEC/NS/AGC** - Echo cancellation, noise suppression, auto-gain. We ask for these via constraints, but browsers treat them as "best effort."

2. **Optional RNNoise** - Deep learning noise suppression. Sounds great but adds 10-20ms latency and eats CPU. Off by default, you can toggle it on.

3. **Input limiter** - Caps at -3 dBFS so you don't clip.

4. **Voice activity detection** - We stop sending packets when you're not talking. Saves bandwidth.

5. **Auto-leveling** - Normalizes to -18 dBFS so everyone sounds roughly the same volume.

The constraints we request (browsers may ignore some):

```typescript
{
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  sampleRate: { ideal: 48000 },
  channelCount: { exact: 1 },  // Force mono
  latency: { ideal: 0.01 },
}
```

### Opus Codec Settings

| Tier | Bitrate | DTX | FEC |
|------|---------|-----|-----|
| Free | 32 kbps | On | On (5% overhead) |
| Pro | 64 kbps | On | On |

DTX = Discontinuous Transmission (saves bandwidth during silence)
FEC = Forward Error Correction (recovers from packet loss)

---

## Privacy Model

### Why Everything Goes Through the SFU

We route all calls through our SFU, even 1:1 DMs. Here's why:

**Direct peer-to-peer exposes your IP address.** WebRTC uses ICE candidates to find the best path between peers. If we let peers connect directly, they see each other's IPs. We could add a "force TURN relay" option, but then we're paying TURN costs anyway and users have to understand the toggle.

So we just route everything through the SFU. Your IP is never exposed to other users. Done.

### Encryption (Be Honest About What We Have)

Standard WebRTC with an SFU uses **hop-by-hop encryption**, not end-to-end. Here's what that means:

```
You ←── DTLS-SRTP ──→ SFU ←── DTLS-SRTP ──→ Them
```

Each hop is encrypted (DTLS-SRTP, per RFC 5764). But the SFU terminates the DTLS connection and can see plaintext audio/video. This is how all standard SFU architectures work.

**What we do with that access:** Nothing. We don't record, we don't store, we don't analyze. The media flows through and that's it.

**True E2EE is possible** using WebRTC Encoded Transforms (Insertable Streams). The client encrypts frames *before* handing them to WebRTC, and the SFU just forwards encrypted blobs it can't read. This is how Signal does video calls.

We haven't shipped this yet. When we do, it'll probably be:
- E2EE on by default for DMs
- Admin choice for community channels
- **E2EE and server-side recording are mutually exclusive**—you can't record what the server can't decrypt. If a community wants recording, E2EE must be off for that channel. If they want E2EE, recording requires each participant to capture locally (with consent).

If E2EE matters to you now, know that the current implementation is "encrypted in transit, server can access." We're not lying about it like some apps do.

### E2EE Rollout Plan

We're not trying to boil the ocean. Here's the plan:

**v1 (ship fast, be honest):**
- SFU everywhere
- DTLS-SRTP hop-by-hop
- No recording
- Clear docs about encryption model

**v1.5 (brand-aligned):**
- E2EE for DM voice/video only, using encoded transforms
- **Key distribution:** Call keys are exchanged over existing E2EE messaging (Signal protocol sessions) using a call-invite message. Keys rotated per call. No new crypto plane—we reuse the same trust model as text.

**v2 (hard mode):**
- E2EE for group voice channels (key rotation on join/leave, sender-keys-like)
- Recording only via client-side capture or explicit opt-in key escrow

Group E2EE is where complexity spikes. We'll get there, but not at the cost of shipping.

### IP Protection

When a user has privacy mode enabled, we force `iceTransportPolicy: 'relay'`. All traffic goes through TURN, no direct connections that could leak IPs.

**To be clear about who sees what:** Privacy mode hides your IP from the SFU and from other users—they only see the TURN relay's IP. The TURN server itself still sees your real IP (it has to, that's how relays work). We keep TURN logs minimal and access-restricted.

TURN credentials are ephemeral (via TURN REST API). They expire in 24 hours. If someone steals a credential, it's not a permanent key.

```typescript
{
  iceServers: [
    {
      urls: ['turn:turn.railgun.app:443?transport=tcp'],
      username: 'timestamp:userId',  // Ephemeral
      credential: 'hmac-generated',   // Expires in 24h
    },
  ],
  iceTransportPolicy: privacyMode ? 'relay' : 'all',
}
```

---

## Feature Gating

We gate Pro features at multiple levels:

### 1. Signaling Server

When you join a voice channel, the server checks your entitlement and tells you what you can do. We never trust client-sent capabilities.

```typescript
// Server-side - we derive permissions, client doesn't tell us
const entitlement = await verifyEntitlementToken(userId);
const permissions = {
  audio: true,                    // Always
  video: entitlement?.isPro,      // Pro only
  screenshare: entitlement?.isPro, // Pro only
  maxBitrate: entitlement?.isPro ? 64000 : 32000,
};
```

### 2. SFU Level

If a free user somehow tries to create a video producer (hacked client, whatever), the SFU rejects it.

```typescript
if (producer.kind === 'video' && !participant.isPro) {
  await producer.close();
  return;
}
```

### 3. Client UI

Lock icons on video/screenshare buttons. Click them, get an upgrade modal. Don't even try to send the request if you're not Pro.

### 4. Runtime Fallback

If your Pro expires mid-call:
1. Video track stops
2. Screen share stops
3. You get a toast notification
4. Audio keeps working

No one gets kicked, no call drops.

---

## SFU Scaling

### The Stickiness Problem

mediasoup is stateful. All the transport, producer, and consumer state lives in memory on a specific worker. You can't move a room to another SFU mid-call.

This means we need room-to-SFU binding:

```
User joins "Room A"
    │
    ▼
Check Redis: "Which SFU has Room A?"
    │
    ├── Found: "sfu-us-east-1a" → Connect to that SFU
    │
    └── Not found: Pick least-loaded SFU in region
                   Store mapping in Redis
                   Connect to chosen SFU
```

### Multi-Region

We'll deploy SFU nodes in multiple regions. The allocator picks based on:
1. User's region (prefer nearby)
2. Node load (prefer less loaded)
3. Node health (avoid degraded nodes)

The signaling server is stateless and can be load-balanced. The SFUs are sticky by room.

### Video Publisher Limits

We cap simultaneous video streams per room:
- Free: 4 video streams
- Pro: 6 video streams

Screen share counts as a video stream. Beyond 6 streams, bandwidth gets out of control.

**Queue fairness policy:**

| Rule | Behavior |
|------|----------|
| Queue order | FIFO per room |
| Slot grant | Automatic when one frees—next in queue gets it immediately |
| Disconnect | Slot released, queued user promoted |
| Reconnect | Back of queue (no slot reservation) |
| Idle timeout | None for v1 (video stays until manually stopped) |
| Admin override | None for v1 |

```typescript
interface VideoSlotQueue {
  roomId: string;
  maxSlots: number;                    // 4 or 6
  activePublishers: Set<string>;       // userId
  waitingQueue: string[];              // userId[], FIFO
  
  requestSlot(userId: string): 'granted' | 'queued';
  releaseSlot(userId: string): void;   // Promotes next in queue
  getQueuePosition(userId: string): number | null;
}
```

UI shows: "Video slots full (4/4) — You're #2 in queue"

---

## Pre-Call Diagnostics

Before joining, users can run checks:

1. **Device selection** - Pick mic, speaker, camera from dropdowns
2. **Mic test** - Real-time level meter, speak and see it move
3. **Speaker test** - Play a tone, confirm you hear it
4. **Echo test** - Record 3 seconds, play it back, check for echo
5. **Network test** - Ping the signaling server, estimate bandwidth

This catches most "I can't hear anyone" issues before they happen.

---

## In-Call Stats

We track and display:

```typescript
{
  transport: 'udp' | 'tcp' | 'turn',
  rtt: number,          // Round-trip time (ms)
  jitter: number,       // Packet jitter (ms)
  packetLoss: number,   // 0-100%
  mos: number,          // Mean Opinion Score (1-5)
}
```

**MOS Calculation** (based on ITU-T G.107 E-model):

```typescript
function calculateMOS(rtt: number, packetLoss: number): number {
  const R = 93.2 - (rtt * 0.024) - (packetLoss * 2.5);
  if (R < 0) return 1.0;
  if (R > 100) return 4.5;
  return 1 + (0.035 * R) + (0.000007 * R * (R - 60) * (100 - R));
}

// 4.0-4.5: Excellent
// 3.5-4.0: Good
// 2.5-3.5: Fair
// 1.0-2.5: Poor
```

---

## Auto-Optimization

When network gets bad, we react:

| Condition | Action |
|-----------|--------|
| RTT > 300ms | Reduce bitrate |
| Packet loss > 5% | Enable more FEC |
| Critical degradation | Pause video, keep audio |
| Low input level | Boost mic gain |

When things recover, we ramp back up.

---

## Abuse Prevention

### Rate Limits

- Max 10 joins per minute
- 5 second cooldown between reconnects

### Audio Abuse Detection

We don't use speaking-time ratios—those punish normal people telling stories. Instead, we look for patterns that indicate abuse:

**Noise loop detection:**
- High energy (RMS > -30 dB)
- Low variance (< 3 dB over 10 seconds)
- No speech detected (VAD never triggers)

This catches constant tones, noise loops, and bots. When detected:
1. Auto-mute the user
2. Show toast: "Muted due to unusual audio"
3. They can unmute, but if it happens 3x → temporary kick

### Feedback Detection

If we detect rapid echo patterns (3 consecutive frames with echo signature):
1. Show toast: "Possible feedback. Use headphones?"
2. Auto-reduce output volume 30%

---

## Recording

**Current policy: No recording by default.**

If we add admin recording later:
- Pro communities only
- Persistent "This channel is recorded" banner
- Users must acknowledge before joining
- Auto-delete after 30 days (GDPR)
- Disabled when E2EE is enabled (can't record what we can't see)

---

## WebSocket Signaling Protocol

All signaling happens over socket.io. The events below map directly to mediasoup's lifecycle—if you're missing any of these, you'll reinvent them ad-hoc and it'll get messy.

### Security Invariants

> **Every socket maps to exactly one authenticated user + device session.**
> All mediasoup objects (`transportId`, `producerId`, `consumerId`) are owned by that session.

On **every** event, validate:
1. Object exists
2. Object belongs to this socket's session (not just any user—this specific connection)
3. Object belongs to the correct room

This is where "hacked client" attacks happen: someone sends a `transportId` that belongs to another user. If you don't validate ownership, they can hijack streams.

```typescript
// Example: validating transport ownership
function validateTransportOwnership(socket: AuthenticatedSocket, transportId: string): Transport {
  const session = getSession(socket.id);  // socket.id, not socket.user.id
  const transport = session.transports.get(transportId);
  
  if (!transport) {
    throw new Error('Transport not found or not owned by this session');
  }
  
  return transport;
}
```

**Never trust IDs from the client without ownership checks.**

### mediasoup Lifecycle Events

The full state machine. Every event needs a server-side handler.

#### Client → Server

| Event | Purpose | Server Checks |
|-------|---------|---------------|
| `voice:join` | Join a channel | Room exists, not banned, not full |
| `voice:leave` | Leave channel | Currently in room |
| `voice:rtc:getRouterRtpCapabilities` | Get SFU codec support | Room membership |
| `voice:rtc:createTransport` | Create send or recv transport | Room membership, one of each max |
| `voice:rtc:connectTransport` | Complete DTLS handshake | Transport exists, owns it |
| `voice:rtc:produce` | Start sending media | Transport connected, kind allowed (audio always, video/screen Pro only), producer limit not hit |
| `voice:rtc:consume` | Subscribe to peer's media | Transport connected, producer exists |
| `voice:rtc:pauseProducer` | Pause outgoing track | Owns producer |
| `voice:rtc:resumeProducer` | Resume outgoing track | Owns producer |
| `voice:rtc:pauseConsumer` | Stop receiving a track | Owns consumer |
| `voice:rtc:resumeConsumer` | Resume receiving | Owns consumer |
| `voice:rtc:closeProducer` | Stop sending a track | Owns producer |
| `voice:state:update` | Mute/deafen state | Room membership |

#### Server → Client

| Event | When Sent |
|-------|-----------|
| `voice:joined` | Join successful, includes participants + permissions + rtcConfig |
| `voice:left` | Leave confirmed |
| `voice:routerRtpCapabilities` | Response to getRouterRtpCapabilities |
| `voice:transportCreated` | Transport ready, includes ICE/DTLS params |
| `voice:transportConnected` | DTLS handshake complete |
| `voice:produced` | Producer created, includes producerId |
| `voice:consumed` | Consumer ready, includes consumerId + rtpParameters |
| `voice:participant:joined` | Peer joined |
| `voice:participant:left` | Peer left |
| `voice:participant:state` | Peer muted/unmuted/etc |
| `voice:newProducer` | Peer started producing (prompt client to consume) |
| `voice:producerClosed` | Peer stopped producing |
| `voice:rtc:error` | Something failed |

### Cleanup Rules

**On client disconnect:**
1. Close all producers (notifies other participants)
2. Close all consumers
3. Close both transports
4. Remove from room
5. If room empty, close router

**On worker death:**
1. All rooms on that worker are gone
2. Notify affected clients to rejoin
3. Alert ops

**On room empty:**
1. Close router
2. Remove from Redis mapping
3. SFU resources freed

### Join Flow (Detailed)

```
Client                          Server                          SFU
──────                          ──────                          ───
  │                                │                              │
  │ voice:join(channelId)          │                              │
  ├───────────────────────────────>│                              │
  │                                │ verify auth + entitlement    │
  │                                │ check room exists/not full   │
  │                                │                              │
  │                                │ getOrCreateRouter(channelId) │
  │                                ├─────────────────────────────>│
  │                                │                              │
  │ voice:joined(permissions,      │                              │
  │   participants, rtcConfig)     │                              │
  │<───────────────────────────────┤                              │
  │                                │                              │
  │ voice:rtc:getRouterRtpCaps     │                              │
  ├───────────────────────────────>│                              │
  │                                │ router.rtpCapabilities       │
  │                                ├─────────────────────────────>│
  │ voice:routerRtpCapabilities    │                              │
  │<───────────────────────────────┤                              │
  │                                │                              │
  │ voice:rtc:createTransport      │                              │
  │   (direction: 'send')          │                              │
  ├───────────────────────────────>│                              │
  │                                │ router.createWebRtcTransport │
  │                                ├─────────────────────────────>│
  │ voice:transportCreated         │                              │
  │   (iceParams, dtlsParams)      │                              │
  │<───────────────────────────────┤                              │
  │                                │                              │
  │ voice:rtc:connectTransport     │                              │
  │   (dtlsParameters)             │                              │
  ├───────────────────────────────>│                              │
  │                                │ transport.connect(dtls)      │
  │                                ├─────────────────────────────>│
  │ voice:transportConnected       │                              │
  │<───────────────────────────────┤                              │
  │                                │                              │
  │ voice:rtc:produce              │                              │
  │   (kind: 'audio')              │                              │
  ├───────────────────────────────>│                              │
  │                                │ check: audio always allowed  │
  │                                │ transport.produce(...)       │
  │                                ├─────────────────────────────>│
  │ voice:produced(producerId)     │                              │
  │<───────────────────────────────┤                              │
  │                                │                              │
  │                                │ broadcast to room:           │
  │                                │ voice:newProducer            │
  │                                ├───────────────────────────>  │
  │                                │  (other clients consume)     │
```

### Produce Flow (Video - Pro Check)

```typescript
// Server-side handler
async handleProduce(socket, { transportId, kind, rtpParameters, appData }) {
  const userId = socket.user.id;  // From auth middleware, never from payload
  const participant = getParticipant(userId);
  
  // Pro check for video/screen
  if (kind === 'video') {
    if (!participant.isPro) {
      return socket.emit('voice:rtc:error', {
        code: 'CAPABILITY_REQUIRED',
        details: { capability: appData.source === 'screen' ? 'SCREEN_SHARE' : 'VIDEO_CALLING' },
      });
    }
    
    // Video publisher limit check
    const room = getRoom(participant.roomId);
    const videoCount = room.getActiveVideoCount();
    const limit = room.isPro ? 6 : 4;
    
    if (videoCount >= limit) {
      return socket.emit('voice:rtc:error', {
        code: 'VIDEO_LIMIT_REACHED',
        details: { current: videoCount, max: limit },
      });
    }
  }
  
  const transport = participant.sendTransport;
  const producer = await transport.produce({ kind, rtpParameters, appData });
  
  // Store reference
  if (kind === 'audio') participant.audioProducer = producer;
  else if (appData.source === 'screen') participant.screenProducer = producer;
  else participant.videoProducer = producer;
  
  socket.emit('voice:produced', { producerId: producer.id });
  
  // Tell others to consume
  room.broadcastExcept(userId, 'voice:newProducer', {
    producerId: producer.id,
    userId,
    kind,
    appData,
  });
}
```

### Original Simplified Events (Still Valid)

For quick reference, here's the minimal API from before:

**voice:join** - Join a voice channel
```typescript
{
  channelId: string,
  rtpCapabilities: object,  // Browser's codec support
}
```

**voice:leave** - Leave
```typescript
{
  channelId: string,
}
```

**voice:rtc:produce** - Start sending audio/video
```typescript
{
  transportId: string,
  kind: 'audio' | 'video',
  rtpParameters: object,
  appData: { source: 'mic' | 'camera' | 'screen' },
}
```

**voice:state:update** - Update mute/deafen state
```typescript
{
  muted: boolean,
  deafened: boolean,
  speaking: boolean,
}
```

### Server → Client

**voice:joined** - Successfully joined
```typescript
{
  channelId: string,
  sfuEndpoint: string,
  participants: [...],
  permissions: {
    audio: boolean,
    video: boolean,
    screenshare: boolean,
    maxBitrate: number,
  },
  rtcConfig: {
    iceServers: [...],
    iceTransportPolicy: 'all' | 'relay',
  },
}
```

**voice:participant:joined** / **voice:participant:left** - Peer events

**voice:rtc:error** - Something went wrong
```typescript
{
  error: string,
  code: 'CAPABILITY_REQUIRED' | 'TRANSPORT_FAILED' | ...,
  details: { capability?: 'VIDEO_CALLING' | 'SCREEN_SHARE' },
}
```

---

## Implementation Guide

### Server Setup (mediasoup)

Install:
```bash
cd services/api
pnpm add mediasoup@3 @types/mediasoup
```

Key files to create:
```
services/api/src/voice/
├── voice.module.ts           # NestJS module
├── voice.gateway.ts          # socket.io handlers
├── voice.service.ts          # Business logic
├── voice-sfu.service.ts      # mediasoup wrapper
└── voice-room.service.ts     # Room state
```

mediasoup config (the important bits):
```typescript
{
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
  },
  router: {
    mediaCodecs: [
      // Mono voice - matches our channelCount: 1 capture constraint
      { 
        kind: 'audio', 
        mimeType: 'audio/opus', 
        clockRate: 48000, 
        channels: 1,  // Mono, not stereo - we force mono on capture
        parameters: {
          useinbandfec: 1,
          usedtx: 1,
          maxaveragebitrate: 64000,  // Let Pro users hit 64kbps
        },
      },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
      { kind: 'video', mimeType: 'video/VP9', clockRate: 90000 },
      { kind: 'video', mimeType: 'video/H264', clockRate: 90000 },
    ],
  },
}
```

Create workers on startup (one per CPU, max 4):
```typescript
const worker = await mediasoup.createWorker({
  logLevel: 'warn',
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
});

worker.on('died', () => {
  console.error('Worker died!');
  // Alert, restart, or crash
});
```

### Client Setup

Install:
```bash
cd apps/desktop
pnpm add mediasoup-client
```

The voice service (`apps/desktop/src/lib/voiceService.ts`) wraps all the WebRTC complexity. Main methods:

```typescript
await initVoiceService(isPro);
const voice = getVoiceService();

await voice.joinChannel(channelId);
await voice.toggleMute();
await voice.toggleDeafen();
await voice.toggleVideo();      // Returns false if not Pro
await voice.toggleScreenShare(); // Returns false if not Pro
voice.setInputVolume(1.5);       // 0-2 (150% boost)
voice.setPerUserVolume(userId, 0.5);
await voice.leaveChannel();
```

### TURN Server

We use Coturn. Two configs: one for local dev, one for production.

**Docker compose:**
```yaml
turn:
  image: instrumentisto/coturn:latest
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
  volumes:
    - ./turnserver.conf:/etc/coturn/turnserver.conf
```

#### Dev Config (Static Credentials)

Fine for local testing. Don't use in prod.

```conf
# turnserver.conf (dev)
listening-port=3478
external-ip=YOUR_PUBLIC_IP
realm=railgun.app

# Static user - simple but credentials never expire
lt-cred-mech
user=railgun:dev_password_123

# Keep STUN enabled so you can use stun: URLs from same box
# (Remove this line - no-stun was wrong)

verbose
```

#### Prod Config (TURN REST / Ephemeral Credentials)

This is what you actually want. Credentials expire, can't be reused if leaked.

```conf
# turnserver.conf (prod)
listening-port=3478
listening-port=443
tls-listening-port=443

external-ip=YOUR_PUBLIC_IP
realm=railgun.app

# REST API style auth (timestamp:userId username, HMAC credential)
use-auth-secret
static-auth-secret=YOUR_HMAC_SECRET_FROM_SECRETS_MANAGER

# TLS (required for 443)
cert=/etc/letsencrypt/live/turn.railgun.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn.railgun.app/privkey.pem

# Security - prevent TURN from becoming SSRF/port-scan cannon
no-multicast-peers
no-cli

# Deny ALL private/reserved ranges (IPv4)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-239.255.255.255
denied-peer-ip=240.0.0.0-255.255.255.255

# Deny private/reserved ranges (IPv6)
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=ff00::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# Logging (minimal in prod)
log-file=/var/log/coturn/turnserver.log
simple-log
```

**TLS notes:**
- Use `turns:` URLs in iceServers for strict clients: `turns:turn.railgun.app:443?transport=tcp`
- Cert rotation: reload coturn on cert renewal (`systemctl reload coturn` or container restart via certbot hook)
- ALPN not required for TURN but doesn't hurt if your LB does it

**Generating ephemeral credentials (server-side):**

```typescript
import * as crypto from 'crypto';

function generateTurnCredentials(userId: string, secret: string, ttlSeconds = 86400) {
  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${timestamp}:${userId}`;
  
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');
  
  return {
    username,
    credential,
    expiresAt: new Date(timestamp * 1000),
  };
}

// Usage in voice:joined response
const turnCreds = generateTurnCredentials(userId, process.env.TURN_SECRET);
return {
  rtcConfig: {
    iceServers: [
      // TLS-secured TURN
      {
        urls: [
          'turns:turn.railgun.app:443?transport=tcp',
          'turn:turn.railgun.app:443?transport=tcp',
        ],
        username: turnCreds.username,
        credential: turnCreds.credential,
      },
      // Include STUN for non-privacy-mode users
      ...(privacyMode ? [] : [{ urls: 'stun:turn.railgun.app:3478' }]),
    ],
    iceTransportPolicy: privacyMode ? 'relay' : 'all',
  },
  turnCredentialExpiresAt: turnCreds.expiresAt.toISOString(),
};
```

### Operational Requirements

**UDP port range:** mediasoup needs ports 40000-49999 (or whatever you configure) open for UDP. This is the most common "WebRTC randomly fails" cause.

- **Docker:** Use host networking or explicit UDP port mapping
- **Kubernetes:** Host networking or NodePort for the entire range
- **Cloud firewalls:** Security groups must allow UDP ingress on the range
- **NAT:** Set `MEDIASOUP_ANNOUNCED_IP` to your public IP

If you're behind NAT and don't set `announcedIp`, clients will try to connect to your private IP and fail silently.

---

## Testing Checklist

### Manual Tests
- [ ] Join channel, hear others, they hear you
- [ ] Mute/unmute works
- [ ] Deafen works
- [ ] Device switching works
- [ ] Pre-call echo test works
- [ ] Network quality indicator updates

### Pro Feature Tests
- [ ] Free user can't start video
- [ ] Free user sees upgrade modal
- [ ] Pro user can start video
- [ ] Video stops when Pro expires
- [ ] Screen share works for Pro

### Load Tests
- [ ] 8 people in free channel
- [ ] 25 people in Pro channel
- [ ] 100 concurrent channels

### Network Simulation
```bash
# Add 100ms latency
sudo tc qdisc add dev eth0 root netem delay 100ms

# Add 5% packet loss
sudo tc qdisc add dev eth0 root netem loss 5%

# Remove
sudo tc qdisc del dev eth0 root
```

---

## Metrics to Track

**Usage:**
- Voice call minutes
- Peak concurrent calls
- Video upgrade CTA clicks/conversions

**Quality:**
- Average MOS across calls
- % of calls with MOS < 3.0
- TURN relay usage %

**Technical:**
- SFU CPU/memory
- Worker crashes
- Transport failures

**The killer signal (early warning radar):**
- **ICE failure rate by region + network type** — % of joins where candidates gather but DTLS never connects. When this spikes for "us-east + mobile" or "eu-west + corporate firewall," you know exactly where to look.

---

## Future Cost Lever (Not v1)

If SFU costs explode before revenue catches up, we have an escape hatch:

**P2P for users who opt into "Low-cost mode":**
- Both parties must enable it
- Both explicitly accept IP exposure
- Otherwise, SFU (default)

This is not for v1. Document it now so we're not trapped later. The UX would be: Settings → Privacy → "Allow direct connections to reduce server costs (exposes your IP to the other party)."

---

## Decisions Still Needed

Before we ship v1, product needs to confirm:

1. **E2EE timeline**: We're shipping v1 with DTLS-SRTP only (honest about it). E2EE for DMs in v1.5. Group E2EE in v2. Sound right?
2. **Recording**: Allow admin recording for Pro communities (with consent banner)? This is mutually exclusive with E2EE—communities pick one.
3. **Mobile**: Voice-only for now, video in a later release?

Once confirmed, we build.

---

## Quick Reference

### Error Codes
```
CHANNEL_NOT_FOUND   - Channel doesn't exist
CHANNEL_FULL        - Hit participant limit
PERMISSION_DENIED   - Banned, etc.
CAPABILITY_REQUIRED - Pro feature, need upgrade
TRANSPORT_FAILED    - WebRTC setup failed
```

### Bitrate Limits
| Tier | Audio | Video | Screen | Total |
|------|-------|-------|--------|-------|
| Free | 32 kbps | — | — | 32 kbps |
| Pro | 64 kbps | 2500 kbps | 1500 kbps | 4 Mbps |

### Participant Limits
| Tier | Voice | Video Publishers |
|------|-------|------------------|
| Free | 8 | 4 |
| Pro | 25 | 6 |

---

## Troubleshooting

**User can't hear anyone:**
1. Check speaker selection
2. Check if deafened
3. Run pre-call diagnostics
4. Check browser permissions

**Echo/feedback:**
1. Use headphones (90% of the time this is it)
2. Reduce speaker volume
3. Move mic away from speakers

**Video not working:**
1. Check Pro status
2. Check camera permissions
3. Check if camera in use by another app

**Poor quality:**
1. Check stats overlay (MOS, packet loss)
2. Close bandwidth-heavy apps
3. Try wired connection
4. Force TURN relay

---

## Client State Machine

This is the single source of truth for client-side voice state. Every socket.io event maps to a state transition. If you're not in the right state, the event is invalid.

```
┌──────────────┐
│ DISCONNECTED │◄────────────────────────────────────────────┐
└──────┬───────┘                                              │
       │ joinChannel()                                        │
       ▼                                                      │
┌──────────────┐  voice:error / timeout                       │
│   JOINING    │─────────────────────────────────────────────►│
└──────┬───────┘                                              │
       │ voice:joined                                         │
       ▼                                                      │
┌──────────────────────┐                                      │
│ FETCHING_RTP_CAPS    │  voice:rtc:error / timeout          │
└──────┬───────────────┘─────────────────────────────────────►│
       │ voice:routerRtpCapabilities                          │
       ▼                                                      │
┌──────────────────────┐                                      │
│ CREATING_TRANSPORTS  │  voice:rtc:error / timeout          │
└──────┬───────────────┘─────────────────────────────────────►│
       │ both transports created                              │
       ▼                                                      │
┌──────────────────────┐                                      │
│ CONNECTING_TRANSPORT │  voice:rtc:error / timeout          │
└──────┬───────────────┘─────────────────────────────────────►│
       │ voice:transportConnected (send)                      │
       ▼                                                      │
┌──────────────┐                                              │
│    READY     │◄─────────────────┐                           │
└──────┬───────┘                  │                           │
       │ produce(audio)           │ producer closed           │
       ▼                          │                           │
┌──────────────────┐              │                           │
│ PRODUCING_AUDIO  │──────────────┘                           │
└──────┬───────────┘                                          │
       │ produce(video) [Pro only]                            │
       ▼                          │                           │
┌──────────────────────────┐      │ producer closed           │
│ PRODUCING_AUDIO_VIDEO    │──────┘                           │
└──────┬───────────────────┘                                  │
       │ produce(screen) [Pro only]                           │
       ▼                          │                           │
┌──────────────────────────────┐  │ producer closed           │
│ PRODUCING_AUDIO_VIDEO_SCREEN │──┘                           │
└──────┬───────────────────────┘                              │
       │                                                      │
       │ leaveChannel() / disconnect / error                  │
       ▼                                                      │
┌──────────────┐                                              │
│   LEAVING    │──────────────────────────────────────────────┘
└──────────────┘
```

### State Transition Rules

| From State | Event | To State | Action |
|------------|-------|----------|--------|
| DISCONNECTED | `joinChannel()` | JOINING | Emit `voice:join` |
| JOINING | `voice:joined` | FETCHING_RTP_CAPS | Store participants, emit `voice:rtc:getRouterRtpCapabilities` |
| JOINING | timeout (10s) | DISCONNECTED | Show error toast |
| FETCHING_RTP_CAPS | `voice:routerRtpCapabilities` | CREATING_TRANSPORTS | Load device, emit `voice:rtc:createTransport` x2 |
| CREATING_TRANSPORTS | both `voice:transportCreated` | CONNECTING_TRANSPORT | Emit `voice:rtc:connectTransport` (send) |
| CONNECTING_TRANSPORT | `voice:transportConnected` | READY | Enable mic button |
| READY | `toggleMute()` off | PRODUCING_AUDIO | Create audio producer |
| PRODUCING_* | `toggleMute()` on | same | Pause producer (don't close) |
| PRODUCING_AUDIO | `toggleVideo()` [Pro] | PRODUCING_AUDIO_VIDEO | Create video producer |
| PRODUCING_AUDIO_VIDEO | `toggleVideo()` | PRODUCING_AUDIO | Close video producer |
| Any | `leaveChannel()` | LEAVING | Close all producers/consumers/transports, emit `voice:leave` |
| Any | socket disconnect | DISCONNECTED | Clean up local state |
| Any | `voice:rtc:error` | depends | If fatal, → DISCONNECTED; if recoverable, retry |

### Retry Policy

| Failure | Retry? | Max Attempts | Backoff |
|---------|--------|--------------|---------|
| `voice:join` timeout | Yes | 3 | 1s, 2s, 4s |
| Transport creation failed | Yes | 2 | 1s |
| DTLS connection failed | Yes | 2 | 1s |
| Producer creation failed | No | — | Show error |
| Socket disconnect | Yes | 5 | 1s, 2s, 4s, 8s, 16s |

### Timeout Values

| Operation | Timeout |
|-----------|---------|
| Join channel | 10s |
| Get RTP capabilities | 5s |
| Create transport | 5s |
| Connect transport | 10s |
| Create producer | 5s |
| Socket reconnect | 30s total |

---

That's it. Questions? Ask in #voice-dev.
