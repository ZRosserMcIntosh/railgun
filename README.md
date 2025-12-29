# Rail Gun 🔫

End-to-end encrypted, Discord-like messaging application with Signal Protocol encryption.

## Features

- **End-to-End Encryption**: Signal Protocol (X3DH + Double Ratchet), Curve25519, ChaCha20-Poly1305
- **Communities**: Create and join servers with multiple channels
- **Direct Messages**: Private 1:1 encrypted conversations
- **Voice & Video**: Real-time voice chat (video for Pro users)
- **Decentralized Exchange**: Built-in crypto swaps via THORChain
- **Cross-Platform**: Desktop (macOS, Windows, Linux)

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

# Start infrastructure (Postgres + Redis)
cd infra && docker-compose up -d

# Install dependencies
pnpm install

# Build shared package
pnpm --filter @railgun/shared build

# Start development
pnpm dev
```

For detailed setup instructions, see [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md).

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/GETTING_STARTED.md) | Installation, setup, running the app |
| [Security](./docs/SECURITY.md) | Cryptographic protocols and security model |
| [Deployment](./docs/DEPLOYMENT.md) | Production deployment and releases |
| [Features](./docs/FEATURES.md) | Voice, DMs, communities documentation |
| [Architecture](./docs/ARCHITECTURE.md) | System design and infrastructure |
| [API Reference](./docs/API.md) | REST and WebSocket API docs |
| [DEX](./docs/DEX.md) | Decentralized exchange documentation |
| [Billing](./docs/BILLING.md) | Pro subscriptions and entitlements |

## Project Structure

```
railgun/
├── packages/shared/     # Shared TypeScript types, DTOs
├── services/api/        # NestJS backend (HTTP + WebSocket)
├── apps/desktop/        # Electron + React desktop client
├── apps/web/            # Next.js web client
├── railgun-site/        # Marketing website
└── infra/               # Docker, deployment configs
```

## Security Model

| Feature | Implementation |
|---------|----------------|
| Key Exchange | X3DH (Extended Triple Diffie-Hellman) |
| Message Encryption | Double Ratchet + ChaCha20-Poly1305 |
| Key Storage | OS Keychain (macOS), DPAPI (Windows) |
| Server Access | Encrypted blobs only (server-blind) |

See [docs/SECURITY.md](./docs/SECURITY.md) for full details.

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in dev mode |
| `pnpm dev:api` | Start API server only |
| `pnpm dev:desktop` | Start desktop app only |
| `pnpm build` | Build all packages |
| `pnpm build:mac` | Build macOS installer |
| `pnpm test` | Run all tests |

## License

Private - All rights reserved.
