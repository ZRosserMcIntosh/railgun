# Rail Gun 🔫

End-to-end encrypted, Discord-like desktop messaging application.

## Features

- **End-to-End Encryption**: All messages are encrypted using the Signal protocol
- **Communities**: Create and join communities with multiple channels
- **Direct Messages**: Private 1:1 and group conversations
- **Presence**: See when your friends are online
- **Cross-Platform**: Native desktop app for macOS (Windows/Linux coming soon)

## Architecture

```
railgun/
├── packages/
│   └── shared/          # Shared TypeScript types, DTOs, protocol enums
├── services/
│   └── api/             # HTTP + WebSocket backend (NestJS)
├── apps/
│   └── desktop/         # Electron + React macOS client
└── infra/               # Docker, migrations, CI scripts
```

## Security Model

- **Device Identity Keys**: Generated on first run, private key never leaves device
- **X3DH Key Exchange**: Secure session establishment using Signal protocol
- **Double Ratchet**: Forward secrecy for all messages
- **Server Blindness**: Server only sees encrypted blobs and routing metadata

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+
- Redis 7+

## Getting Started

```bash
# Install dependencies
pnpm install

# Build shared package
pnpm --filter @railgun/shared build

# Start development
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

## Development

### Project Structure

- `packages/shared`: Common types, DTOs, enums, and utilities
- `services/api`: Backend API server with WebSocket support
- `apps/desktop`: Electron desktop application

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all packages in development mode |
| `pnpm dev:api` | Start only the API server |
| `pnpm dev:desktop` | Start only the desktop app |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format all files |

## Implementation Stages

- [x] Stage 0: Repository & Tooling
- [ ] Stage 1: Minimal Backend (No Encryption)
- [ ] Stage 2: Desktop Skeleton (No Encryption)
- [ ] Stage 3: Key Infrastructure & 1:1 E2E DMs
- [ ] Stage 4: Encrypted Communities & Channels
- [ ] Stage 5: UX Polish & macOS Packaging

## License

Private - All rights reserved.
