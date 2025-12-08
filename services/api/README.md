# Rail Gun API Service

Backend API service for Rail Gun, providing:
- RESTful HTTP endpoints for auth, users, communities, channels
- WebSocket gateway for real-time messaging
- JWT-based authentication

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3001` |
| `DATABASE_HOST` | PostgreSQL host | `localhost` |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_NAME` | Database name | `railgun` |
| `DATABASE_USER` | Database user | `railgun` |
| `DATABASE_PASSWORD` | Database password | - |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_ACCESS_EXPIRY` | Access token expiry | `15m` |
| `JWT_REFRESH_EXPIRY` | Refresh token expiry | `7d` |

## Development

```bash
# From monorepo root
pnpm infra:start    # Start PostgreSQL & Redis
pnpm dev:api        # Start API in watch mode

# From this directory
pnpm dev            # Start in watch mode
pnpm build          # Build for production
pnpm test           # Run tests
```

## API Endpoints

### Health
- `GET /api/v1/health` - Health check
- `GET /api/v1/health/ready` - Readiness probe
- `GET /api/v1/health/live` - Liveness probe

### Auth
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh tokens
- `POST /api/v1/auth/logout` - Logout (requires auth)

## WebSocket

Connect to `/ws` namespace with JWT token:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/ws', {
  auth: { token: 'your-jwt-token' }
});

// Events
socket.on('authenticated', (data) => { ... });
socket.on('message:received', (message) => { ... });

// Send message
socket.emit('message:send', { content: 'Hello!', channelId: 'test' });
```

## Architecture

```
src/
├── main.ts              # Application entry point
├── app.module.ts        # Root module
├── auth/                # Authentication module
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   └── jwt-auth.guard.ts
├── users/               # Users module
│   ├── user.entity.ts
│   └── users.service.ts
├── gateway/             # WebSocket gateway
│   └── events.gateway.ts
└── health/              # Health checks
    └── health.controller.ts
```
