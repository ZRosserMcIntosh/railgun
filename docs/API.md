# Rail Gun API Reference

Last updated: December 28, 2025

Complete API documentation including REST endpoints, WebSocket events, and database operations.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [REST Endpoints](#rest-endpoints)
4. [WebSocket Events](#websocket-events)
5. [Rate Limiting](#rate-limiting)
6. [Error Handling](#error-handling)

---

## Overview

### Base URL

```
Development: http://localhost:3001/api/v1
Production:  https://api.railgun.app/api/v1
```

### Request Format

```http
Content-Type: application/json
Authorization: Bearer <access_token>
```

### Response Format

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2025-12-28T00:00:00Z"
  }
}
```

---

## Authentication

### Register

```http
POST /auth/register
```

**Body:**
```json
{
  "username": "alice",
  "password": "securePassword123",
  "displayName": "Alice"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "user": {
    "id": "uuid",
    "username": "alice",
    "displayName": "Alice"
  }
}
```

### Login

```http
POST /auth/login
```

**Body:**
```json
{
  "username": "alice",
  "password": "securePassword123"
}
```

### Refresh Token

```http
POST /auth/refresh
```

**Body:**
```json
{
  "refreshToken": "eyJhbG..."
}
```

### Logout

```http
POST /auth/logout
Authorization: Bearer <access_token>
```

---

## REST Endpoints

### Users

#### Search Users

```http
GET /users/search?query=ali
Authorization: Bearer <token>
```

**Response:**
```json
{
  "users": [
    {
      "id": "uuid",
      "username": "alice",
      "displayName": "Alice",
      "avatarUrl": null
    }
  ]
}
```

**Rate Limit:** 10 requests/minute

#### Get User by Username

```http
GET /users/by-username/alice
Authorization: Bearer <token>
```

**Rate Limit:** 30 requests/minute

#### Get Current User

```http
GET /users/me
Authorization: Bearer <token>
```

#### Update Profile

```http
PATCH /users/me
Authorization: Bearer <token>
```

**Body:**
```json
{
  "displayName": "Alice Smith",
  "avatarUrl": "https://..."
}
```

---

### Direct Messages

#### Start DM

```http
POST /dms
Authorization: Bearer <token>
```

**Body:**
```json
{
  "username": "bob"
}
```

**Response:**
```json
{
  "conversationId": "alice:bob",
  "peer": {
    "id": "uuid",
    "username": "bob",
    "displayName": "Bob"
  }
}
```

#### List DM Conversations

```http
GET /dms
Authorization: Bearer <token>
```

**Response:**
```json
{
  "conversations": [
    {
      "conversationId": "alice:bob",
      "peer": { ... },
      "lastMessage": { ... },
      "unreadCount": 2
    }
  ]
}
```

#### Get DM Messages

```http
GET /dms/:conversationId/messages?limit=50&before=<messageId>
Authorization: Bearer <token>
```

---

### Communities

#### Create Community

```http
POST /communities
Authorization: Bearer <token>
```

**Body:**
```json
{
  "name": "My Server",
  "description": "A cool server"
}
```

#### List Joined Communities

```http
GET /communities
Authorization: Bearer <token>
```

#### Get Community Details

```http
GET /communities/:id
Authorization: Bearer <token>
```

#### Join via Invite

```http
POST /communities/join
Authorization: Bearer <token>
```

**Body:**
```json
{
  "inviteCode": "ABC123"
}
```

#### Update Community

```http
PATCH /communities/:id
Authorization: Bearer <token>
```

**Requires:** `MANAGE_COMMUNITY` permission

---

### Channels

#### Create Channel

```http
POST /communities/:id/channels
Authorization: Bearer <token>
```

**Body:**
```json
{
  "name": "general",
  "type": "TEXT",
  "description": "General chat"
}
```

**Requires:** `MANAGE_CHANNELS` permission

#### Get Channel Messages

```http
GET /channels/:id/messages?limit=50&before=<messageId>
Authorization: Bearer <token>
```

---

### Crypto (Key Management)

#### Upload Key Bundle

```http
POST /crypto/keys/bundle
Authorization: Bearer <token>
```

**Body:**
```json
{
  "identityKey": "base64...",
  "signedPreKey": {
    "keyId": 1,
    "publicKey": "base64...",
    "signature": "base64..."
  },
  "preKeys": [
    { "keyId": 1, "publicKey": "base64..." },
    { "keyId": 2, "publicKey": "base64..." }
  ],
  "registrationId": 12345
}
```

#### Get User's Key Bundle

```http
GET /crypto/keys/:userId/bundle
Authorization: Bearer <token>
```

#### Upload Pre-Keys

```http
POST /crypto/keys/prekeys
Authorization: Bearer <token>
```

---

### Billing

#### Create Checkout Session

```http
POST /billing/checkout
Authorization: Bearer <token>
```

**Body:**
```json
{
  "plan": "PRO",
  "billingPeriod": "monthly"
}
```

**Response:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

#### Get Subscription Status

```http
GET /billing/status
Authorization: Bearer <token>
```

#### Customer Portal

```http
POST /billing/portal
Authorization: Bearer <token>
```

---

### QR Authentication

#### Create Session

```http
POST /auth/sessions
```

**Response:**
```json
{
  "sessionId": "uuid",
  "secret": "random-secret",
  "expiresAt": "2025-12-28T00:05:00Z"
}
```

#### Get Session Status

```http
GET /auth/sessions/:id
```

#### Complete Session (Mobile)

```http
POST /auth/sessions/:id/complete
```

**Body:**
```json
{
  "secret": "random-secret",
  "userId": "uuid",
  "accessToken": "eyJhbG..."
}
```

#### Exchange for Token

```http
POST /auth/sessions/:id/exchange
```

**Body:**
```json
{
  "secret": "random-secret"
}
```

---

## WebSocket Events

### Connection

```typescript
import { io } from 'socket.io-client';

const socket = io('wss://api.railgun.app', {
  auth: { token: accessToken }
});
```

### Namespaces

| Namespace | Purpose |
|-----------|---------|
| `/` | Default (messages, presence) |
| `/auth` | QR authentication events |
| `/voice` | Voice/video signaling |

### Client → Server Events

#### Join Channel

```typescript
socket.emit('channel:join', { channelId: 'uuid' });
```

#### Leave Channel

```typescript
socket.emit('channel:leave', { channelId: 'uuid' });
```

#### Join DM

```typescript
socket.emit('dm:join', { conversationId: 'alice:bob' });
```

#### Send Message

```typescript
socket.emit('message:send', {
  type: 'CHANNEL' | 'DM',
  targetId: 'channelId or conversationId',
  encryptedContent: 'base64...',
  nonce: 'base64...'
});
```

#### Typing Indicator

```typescript
socket.emit('typing', {
  targetId: 'channelId or conversationId',
  isTyping: true
});
```

#### Update Presence

```typescript
socket.emit('presence:update', {
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE'
});
```

### Server → Client Events

#### New Message

```typescript
socket.on('message:new', (message) => {
  // {
  //   id: 'uuid',
  //   senderId: 'uuid',
  //   encryptedContent: 'base64...',
  //   createdAt: '2025-12-28T...'
  // }
});
```

#### Message Acknowledged

```typescript
socket.on('message:ack', ({ messageId, status }) => {
  // status: 'DELIVERED' | 'READ'
});
```

#### Typing

```typescript
socket.on('typing', ({ userId, targetId, isTyping }) => {});
```

#### Presence Update

```typescript
socket.on('presence:update', ({ userId, status }) => {});
```

#### User Joined/Left

```typescript
socket.on('user:joined', ({ userId, channelId }) => {});
socket.on('user:left', ({ userId, channelId }) => {});
```

---

## Rate Limiting

### Default Limits

| Endpoint Pattern | Limit | Window |
|-----------------|-------|--------|
| `/users/search` | 10 | 1 minute |
| `/users/by-username` | 30 | 1 minute |
| `/auth/*` | 5 | 1 minute |
| `/dms` POST | 30 | 1 minute |
| `/messages` POST | 60 | 1 minute |
| Default | 100 | 1 minute |

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1703721600
```

### Rate Limit Response

```http
HTTP/1.1 429 Too Many Requests

{
  "statusCode": 429,
  "message": "Rate limit exceeded",
  "retryAfter": 45
}
```

---

## Error Handling

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": [
    {
      "field": "username",
      "message": "Username must be at least 3 characters"
    }
  ]
}
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing/invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

### WebSocket Errors

```typescript
socket.on('error', (error) => {
  // {
  //   code: 'AUTH_FAILED' | 'RATE_LIMITED' | 'INVALID_MESSAGE',
  //   message: 'Description'
  // }
});
```
