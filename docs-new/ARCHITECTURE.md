# Rail Gun System Architecture

Last updated: December 28, 2025

Technical documentation of Rail Gun's system architecture, P2P network, and infrastructure.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Project Structure](#project-structure)
3. [Backend Architecture](#backend-architecture)
4. [P2P Relay Network](#p2p-relay-network)
5. [Takedown Resilience](#takedown-resilience)
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

## P2P Relay Network

### Overview

Rail Gun can operate in a decentralized mode where users share message relay duties, eliminating central server dependencies.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bootstrap Nodes                               │
│  (Minimal stateless rendezvous - no message content)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Kademlia DHT (libp2p)                           │
│  • Peer discovery by topic/room hash                            │
│  • NAT traversal coordination (STUN/TURN hints)                 │
│  • Relay committee announcements                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              WebRTC Data Channels / QUIC                        │
│  • Direct peer-to-peer encrypted transport                      │
│  • Fallback through TURN when direct fails                      │
└─────────────────────────────────────────────────────────────────┘
```

### Relay Committee System

For each channel/conversation, a committee of 3-7 peers handles message fanout:

```typescript
function selectCommittee(roomId: string, epoch: number): PeerId[] {
  const seed = hash(roomId + epoch.toString());
  const eligiblePeers = getActivePeers().filter(p => p.reputation >= MIN_REP);
  return deterministicSample(eligiblePeers, COMMITTEE_SIZE, seed);
}

// Rotation: Every 10 minutes with 2-minute overlap
```

### Message Flow

```
Sender → Committee (3 peers) → Recipients
  │           │
  │   verify PoW/reputation
  │   fanout to relays
  │           │
  │   each relay forwards to 1/3 of room
  │           │
  ◄───[ACK]───┘
```

### Reputation System

Peers earn reputation through:
- **Uptime**: Consistent availability
- **Throughput**: Successful relay within latency bounds
- **Stake** (optional): Bonding tokens for trust weight

---

## Takedown Resilience

### Bootstrap Resilience

Multiple transport addresses for each bootstrap node:

```typescript
interface BootstrapNode {
  peerId: string;
  addresses: {
    ipv4?: string[];      // Direct IP
    ipv6?: string[];      // IPv6
    dns?: string[];       // DNS (least resilient)
    onion?: string[];     // Tor .onion v3
    i2p?: string[];       // I2P b32
    ipfs?: string[];      // IPFS
  };
  publicKey: string;      // Ed25519
  signature: string;      // Self-signature
}
```

### Resolution Strategy

```
1. Load cached peer list (if < 24h old)
     ↓
2. Try ALL bootstrap transports IN PARALLEL:
   ┌─────────────┬─────────────┬─────────────┬──────────────┐
   │ Direct IP   │ Tor .onion  │ I2P         │ IPFS Gateway │
   │ (fastest)   │ (anonymous) │ (anonymous) │ (resilient)  │
   └─────────────┴─────────────┴─────────────┴──────────────┘
     ↓
3. First 3 successful → start DHT discovery
     ↓
4. Cache discovered peers locally
     ↓
5. Peer-assisted discovery (ask peers for their lists)
```

### Update Distribution

Multiple channels for software updates:

| Channel | Resilience | Speed |
|---------|------------|-------|
| GitHub Releases | Medium | Fast |
| IPFS | High | Medium |
| BitTorrent | Very High | Variable |
| P2P DHT | Highest | Slow |

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
