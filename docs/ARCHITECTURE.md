# Rail Gun System Architecture

Last updated: December 28, 2025

Technical documentation of Rail Gun's system architecture, P2P network, and infrastructure.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Project Structure](#project-structure)
3. [Backend Architecture](#backend-architecture)
4. [Hybrid Network Architecture](#hybrid-network-architecture)
5. [Resilience Design](#resilience-design)
6. [Database Schema](#database-schema)

---

## System Overview

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + TypeScript |
| **Desktop Shell** | Electron 28 |
| **UI Framework** | Tailwind CSS |
| **State Management** | Zustand |
| **Backend** | NestJS 10 |
| **Database** | PostgreSQL 15 |
| **Cache** | Redis 7 |
| **Real-time** | Socket.IO |
| **Encryption** | Signal Protocol (libsignal) |
| **Build** | Vite + pnpm |

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │   Desktop   │  │    Web      │  │   Mobile    │                  │
│  │  (Electron) │  │  (Next.js)  │  │   (Expo)    │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────▼──────┐
                    │   API/WS    │
                    │  (NestJS)   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
   │  PostgreSQL │  │    Redis    │  │   Storage   │
   │  (Data)     │  │  (Cache)    │  │  (Files)    │
   └─────────────┘  └─────────────┘  └─────────────┘
```

---

## Project Structure

```
railgun/
├── packages/
│   └── shared/              # Shared TypeScript types, DTOs, enums
│       └── src/
│           ├── types/       # Type definitions
│           ├── dto/         # Data transfer objects
│           └── enums/       # Shared enumerations
│
├── services/
│   └── api/                 # Backend API server
│       └── src/
│           ├── auth/        # Authentication, JWT, rate limiting
│           ├── users/       # User management
│           ├── messages/    # DM and channel messages
│           ├── communities/ # Community/server management
│           ├── gateway/     # WebSocket gateway
│           ├── crypto/      # Server-side crypto (key bundles)
│           ├── billing/     # Stripe integration, Pro features
│           └── migrations/  # Database migrations
│
├── apps/
│   ├── desktop/             # Electron desktop client
│   │   └── src/
│   │       ├── components/  # React components
│   │       ├── stores/      # Zustand stores
│   │       ├── crypto/      # Client-side Signal Protocol
│   │       ├── lib/         # Utilities, services
│   │       └── billing/     # Entitlement verification
│   │
│   └── web/                 # Next.js web client
│       └── src/
│           ├── app/         # App router pages
│           └── components/  # Shared components
│
├── railgun-site/            # Marketing website
│   └── src/
│       ├── app/             # Next.js pages
│       ├── components/      # Site components
│       └── lib/             # Configuration
│
├── infra/                   # Infrastructure
│   ├── docker-compose.yml   # Local dev (Postgres + Redis)
│   └── scripts/             # Deployment scripts
│
└── docs/                    # Documentation
```

---

## Backend Architecture

### Module Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         AppModule                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  AuthModule  │  │ UsersModule  │  │MessagesModule│          │
│  │              │  │              │  │              │          │
│  │ - JWT Auth   │  │ - CRUD       │  │ - DMs        │          │
│  │ - Rate Limit │  │ - Search     │  │ - Channels   │          │
│  │ - QR Auth    │  │ - Profiles   │  │ - History    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │Communities   │  │ GatewayModule│  │ CryptoModule │          │
│  │Module        │  │              │  │              │          │
│  │              │  │ - WebSocket  │  │ - Key Bundles│          │
│  │ - Servers    │  │ - Events     │  │ - PreKeys    │          │
│  │ - Channels   │  │ - Presence   │  │ - Sessions   │          │
│  │ - Roles      │  │              │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │BillingModule │  │ RedisModule  │  │AnalyticsModule│         │
│  │              │  │              │  │              │          │
│  │ - Stripe     │  │ - Cache      │  │ - Telemetry  │          │
│  │ - Webhooks   │  │ - Sessions   │  │ - Health     │          │
│  │ - Entitle.   │  │ - Rate Limit │  │ - Updates    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### WebSocket Gateway

Room-based architecture for real-time messaging:

```typescript
// Room naming conventions
`channel:{channelId}`     // Channel messages
`dm:{conversationId}`     // Direct messages
`community:{communityId}` // Community events
`user:{userId}`           // User-specific events

// Key events
'message:send'      // Send encrypted message
'message:ack'       // Delivery acknowledgment
'channel:join'      // Join channel room
'dm:join'           // Join DM room
'typing'            // Typing indicator
'presence:update'   // Online/offline status
```

---

## Hybrid Network Architecture

Rail Gun uses a **three-plane hybrid architecture** that provides resilience without overpromising. The goal is to make Rail Gun **expensive and brittle to block**, not "impossible to take down."

### Network Modes

Users can choose their preferred network mode based on their priorities:

| Mode | Description | Privacy | Reliability | Cost |
|------|-------------|---------|-------------|------|
| **Standard** (default) | Cloud primary, relay fallback | Medium | High | Server pays |
| **Privacy Mode** | Relay-only, no direct connections | High | Medium | Relays pay |
| **Low-Cost / LAN** | Direct P2P preferred | Low | Variable | Peers pay |

```
┌─────────────────────────────────────────────────────────────────┐
│                    User's Network Mode Setting                   │
├─────────────────────────────────────────────────────────────────┤
│  ● Standard (default)    - Cloud when available, relay fallback │
│  ○ Privacy Mode          - Relay-only, no direct connections    │
│  ○ Low-Cost / LAN Mode   - Direct P2P preferred, minimal relay  │
└─────────────────────────────────────────────────────────────────┘
```

### Three Transport Planes

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONTROL PLANE                                │
│  Discovery + Membership (find peers without trusting them)       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │Cloud Rendez- │  │ Peer Cache + │  │  DHT Fallback│          │
│  │vous (fast)   │  │ Exchange (PX)│  │ (dark mode)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA PLANE                                  │
│  Message Transport (encrypted envelopes, multiple routes)        │
│                                                                  │
│  Route A: WebSocket ──► Your servers (fast, consistent)         │
│  Route B: P2P Overlay ─► libp2p/QUIC/WebRTC (direct)           │
│  Route C: Relay ──────► Committee nodes (privacy/fallback)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PERSISTENCE PLANE                              │
│  History + Consistency                                           │
│                                                                  │
│  Cloud up:   Full history, search, attachments                  │
│  Cloud down: Realtime works, history may be partial             │
└─────────────────────────────────────────────────────────────────┘
```

### Message Routing Algorithm

The client determines transport based on network mode and availability:

```typescript
type NetworkMode = 'standard' | 'privacy' | 'lowcost';

interface DeliveryResult {
  success: boolean;
  route: 'cloud' | 'relay' | 'direct' | 'queued';
  latencyMs?: number;
}

async function routeMessage(
  envelope: EncryptedEnvelope,
  mode: NetworkMode
): Promise<DeliveryResult> {
  
  // Privacy mode: relay only, never expose IP to peers
  if (mode === 'privacy') {
    return sendViaRelay(envelope);
  }
  
  // Low-cost mode: try direct P2P first (peers see IPs)
  if (mode === 'lowcost') {
    const direct = await tryDirectP2P(envelope, { timeout: 3000 });
    if (direct.success) return direct;
    // Fall back to relay if direct fails (NAT issues, etc.)
    return sendViaRelay(envelope);
  }
  
  // Standard mode: cloud first, then relay, then direct
  const cloud = await tryCloudWS(envelope, { timeout: 2000 });
  if (cloud.success) return cloud;
  
  // Cloud unavailable - try relay network
  const relay = await tryRelay(envelope, { timeout: 5000 });
  if (relay.success) return relay;
  
  // Everything failed - queue for retry with exponential backoff
  return queueForRetry(envelope);
}
```

### Message Envelope Structure

Every message includes deduplication and routing metadata:

```typescript
interface MessageEnvelope {
  // Deduplication
  messageId: string;          // UUID, globally unique
  conversationId: string;     // Channel or DM conversation
  senderDeviceId: number;
  timestamp: number;          // Unix ms
  ttl: number;                // Seconds until expiry
  
  // Routing
  routeHint?: 'cloud' | 'relay' | 'direct';
  priority: 'normal' | 'high';
  
  // Payload (E2E encrypted, opaque to relays)
  ciphertext: string;
  messageType: number;
}

// Recipients and relays dedupe by (conversationId, messageId)
```

### Relay Committee System

For relay-assisted delivery, messages go through a committee of relay nodes:

```typescript
interface RelayCommittee {
  roomId: string;
  epoch: number;              // Rotates every 10 minutes
  members: RelayNode[];       // 3-7 nodes
  overlapPeriod: number;      // 2-minute overlap for handoff
}

// Committee selection (Sybil-resistant)
function selectCommittee(roomId: string, epoch: number): RelayNode[] {
  const seed = hash(roomId + epoch.toString());
  
  // IMPORTANT: Committee drawn from room MEMBERS + anchor relays
  // Not from open global peer pool (prevents Sybil attacks)
  const eligible = [
    ...getOnlineMemberDevices(roomId),  // Room members
    ...getAnchorRelays(),                // Your operated relays (multi-cloud)
  ];
  
  return deterministicSample(eligible, COMMITTEE_SIZE, seed);
}
```

**Why member-based committees:**
- Open peer pools get Sybil'd (attacker spins up nodes to dominate)
- Member devices have natural admission control (room membership)
- Anchor relays (your infra) ensure reliability when members are offline

### Offline Delivery (Mailbox)

For offline recipients, relays provide encrypted store-and-forward:

```typescript
interface Mailbox {
  // Derived from room key material, not user ID (unlinkable)
  mailboxToken: string;
  
  // Encrypted messages waiting for pickup
  messages: Array<{
    envelope: MessageEnvelope;
    storedAt: number;
    expiresAt: number;  // TTL enforcement
  }>;
}

// Relays never decrypt - they just store ciphertext blobs
// Clients fetch by presenting mailboxToken (proves room membership)
```

---

## Resilience Design

### What Rail Gun Can Promise

✅ **No single cloud provider dependency**
- Multi-region, multi-provider deployment
- Relay fallback when primary is blocked

✅ **No single bootstrap dependency**
- Multiple transport addresses (IPv4, IPv6, Tor, I2P)
- Cached peer lists (24h validity)
- Peer-assisted discovery

✅ **Messages remain confidential even if relays/servers are hostile**
- End-to-end encryption (Signal Protocol)
- Relays only see encrypted blobs

✅ **Realtime works during partial outages**
- Overlay fallback when cloud is down
- Local-first message queue with retry

### What Rail Gun Cannot Promise

❌ **"Impossible to take down"**
- A nation-state can block traffic patterns, throttle, or criminalize usage
- Our goal: make blocking **expensive and brittle**, not impossible

❌ **Full history during outages**
- Cloud provides authoritative history and search
- During outages: realtime works, but history may be partial

❌ **Zero metadata leakage**
- Relays see source IPs (mitigated by Tor/I2P options)
- Traffic analysis is always possible at network layer

### Bootstrap Resilience

Multiple transport addresses for each bootstrap node:

```typescript
interface BootstrapNode {
  peerId: string;
  addresses: {
    ipv4?: string[];      // Direct IP (fastest)
    ipv6?: string[];      // IPv6
    dns?: string[];       // DNS (least resilient)
    onion?: string[];     // Tor .onion v3 (anonymous)
    i2p?: string[];       // I2P b32 (anonymous)
  };
  publicKey: string;      // Ed25519 for signature verification
  signature: string;      // Self-signature (prevents tampering)
}
```

### Discovery Resolution Strategy

```
1. Load cached peer list (if < 24h old)
     ↓
2. Try ALL bootstrap transports IN PARALLEL:
   ┌─────────────┬─────────────┬─────────────┐
   │ Direct IP   │ Tor .onion  │ I2P         │
   │ (fastest)   │ (anonymous) │ (anonymous) │
   └─────────────┴─────────────┴─────────────┘
     ↓
3. First 3 successful → populate peer cache
     ↓
4. Start peer exchange (PX) with connected peers
     ↓
5. DHT discovery (dark mode) if all else fails
```

### Update Distribution

Multiple channels for software updates (defense in depth):

| Channel | Resilience | Speed | Verification |
|---------|------------|-------|--------------|
| GitHub Releases | Medium | Fast | Signature |
| IPFS | High | Medium | Hash + Signature |
| BitTorrent | Very High | Variable | Hash + Signature |
| P2P DHT | Highest | Slow | Hash + Signature |

All updates are signed with Ed25519 keys. Clients verify signatures before applying.

### Implementation Roadmap

**v1 (Shippable)**
- Cloud WebSocket is primary transport
- Add libp2p peer discovery + peer cache
- Peer relay as fallback transport (not full committees)

**v1.5**
- Relay pool nodes (multi-cloud + volunteer)
- Room→relay stickiness in Redis
- Encrypted mailbox for offline delivery

**v2**
- DHT-enabled relay discovery
- Committee per room with rotation
- Formal Sybil resistance (member-based + stake options)

---

## Database Schema

### Core Entities

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│    users     │     │  dm_conversations │     │   messages   │
├──────────────┤     ├──────────────────┤     ├──────────────┤
│ id           │     │ id               │     │ id           │
│ username     │     │ participant1_id  │◄────│ sender_id    │
│ display_name │     │ participant2_id  │     │ conversation_│
│ password_hash│     │ created_at       │     │   id         │
│ created_at   │     │ updated_at       │     │ encrypted_   │
│ updated_at   │     └──────────────────┘     │   content    │
└──────────────┘                              │ created_at   │
       │                                      └──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ communities  │     │    channels      │     │   members    │
├──────────────┤     ├──────────────────┤     ├──────────────┤
│ id           │◄────│ community_id     │     │ id           │
│ name         │     │ name             │     │ user_id      │
│ description  │     │ description      │     │ community_id │
│ owner_id     │     │ type             │     │ role_id      │
│ invite_code  │     │ created_at       │     │ joined_at    │
│ created_at   │     └──────────────────┘     └──────────────┘
└──────────────┘
       │
       ▼
┌──────────────┐
│    roles     │
├──────────────┤
│ id           │
│ community_id │
│ name         │
│ permissions  │
│ color        │
│ position     │
└──────────────┘
```

### Crypto Tables

```
┌──────────────────┐     ┌──────────────────┐
│  identity_keys   │     │    pre_keys      │
├──────────────────┤     ├──────────────────┤
│ user_id          │     │ id               │
│ device_id        │     │ user_id          │
│ public_key       │     │ device_id        │
│ registration_id  │     │ key_id           │
│ created_at       │     │ public_key       │
└──────────────────┘     │ is_signed        │
                         │ signature        │
┌──────────────────┐     │ created_at       │
│  auth_sessions   │     └──────────────────┘
├──────────────────┤
│ id               │     ┌──────────────────┐
│ secret_hash      │     │ billing_profiles │
│ status           │     ├──────────────────┤
│ user_id          │     │ id               │
│ expires_at       │     │ user_id          │
│ created_at       │     │ billing_ref      │
└──────────────────┘     │ stripe_customer  │
                         │ plan             │
                         │ status           │
                         └──────────────────┘
```
