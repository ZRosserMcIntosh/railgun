# Railgun Node Mode - API Specification

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Draft

---

## 1. Overview

This document specifies the REST API endpoints and WebSocket events for Node Mode gateway operations. These APIs enable mesh nodes with internet connectivity to bridge messages between the mesh and Railgun servers.

---

## 2. Authentication

All gateway endpoints require authentication via the standard Railgun JWT token plus a node identity signature.

### Request Headers

```
Authorization: Bearer <jwt_token>
X-Node-Id: <base64_node_public_key>
X-Node-Signature: <base64_signature>
X-Node-Timestamp: <unix_timestamp_ms>
```

### Signature Computation

```
signature_payload = node_id || timestamp || request_body_hash
signature = Ed25519_Sign(node_private_key, signature_payload)
```

### Signature Verification (Server)

```python
def verify_gateway_request(request):
    node_id = base64_decode(request.headers['X-Node-Id'])
    signature = base64_decode(request.headers['X-Node-Signature'])
    timestamp = int(request.headers['X-Node-Timestamp'])
    
    # Check timestamp freshness (5 minute window)
    if abs(time.now_ms() - timestamp) > 300_000:
        raise TimestampError()
    
    # Compute payload
    body_hash = sha256(request.body or b'')
    payload = node_id + timestamp.to_bytes(8, 'big') + body_hash
    
    # Verify signature
    if not ed25519_verify(node_id, payload, signature):
        raise SignatureError()
```

---

## 3. REST API Endpoints

### 3.1 Upload Bundles

Upload bundles from mesh to server for delivery to online users.

**Endpoint:** `POST /api/v1/mesh/upload`

**Request Body:**

```json
{
  "bundles": [
    {
      "bundleId": "550e8400-e29b-41d4-a716-446655440000",
      "version": 1,
      "flags": 1,
      "priority": 1,
      "hopCount": 2,
      "maxHops": 10,
      "createdAt": 1736668800000,
      "expiresAt": 1736928000000,
      "sourceNode": "base64_32_bytes",
      "destinationType": 0,
      "destination": "base64_32_bytes_user_id",
      "geoHash": "u4pruydqqvj",
      "payload": "base64_encrypted_envelope",
      "signature": "base64_64_bytes"
    }
  ],
  "metadata": {
    "nodeCapabilities": 31,
    "meshSize": 12,
    "avgDeliveryTime": 3600
  }
}
```

**Response (200 OK):**

```json
{
  "accepted": [
    {
      "bundleId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "queued",
      "estimatedDelivery": 1736669400000
    }
  ],
  "rejected": [
    {
      "bundleId": "...",
      "reason": "expired",
      "code": "BUNDLE_EXPIRED"
    }
  ],
  "serverTime": 1736668850000
}
```

**Error Responses:**

| Code | Error | Description |
|------|-------|-------------|
| 400 | INVALID_BUNDLE | Bundle format invalid |
| 401 | AUTH_FAILED | JWT or node signature invalid |
| 413 | PAYLOAD_TOO_LARGE | Request exceeds 1MB |
| 429 | RATE_LIMITED | Too many uploads |

---

### 3.2 Download Bundles

Download messages destined for mesh users who are currently offline.

**Endpoint:** `GET /api/v1/mesh/download`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | int | No | Max bundles to return (default: 100, max: 1000) |
| minPriority | int | No | Minimum priority level (0-3) |
| destinations | string | No | Comma-separated user IDs to filter |

**Response (200 OK):**

```json
{
  "bundles": [
    {
      "bundleId": "550e8400-e29b-41d4-a716-446655440001",
      "version": 1,
      "flags": 0,
      "priority": 1,
      "hopCount": 0,
      "maxHops": 10,
      "createdAt": 1736668700000,
      "expiresAt": 1736927900000,
      "sourceNode": "base64_server_node_id",
      "destinationType": 0,
      "destination": "base64_32_bytes_user_id",
      "payload": "base64_encrypted_envelope",
      "signature": "base64_server_signature"
    }
  ],
  "hasMore": true,
  "nextCursor": "cursor_token",
  "usersOnline": [
    "user_id_1",
    "user_id_2"
  ],
  "serverTime": 1736668850000
}
```

---

### 3.3 Acknowledge Delivery

Confirm that bundles have been delivered to their destinations.

**Endpoint:** `POST /api/v1/mesh/ack`

**Request Body:**

```json
{
  "delivered": [
    {
      "bundleId": "550e8400-e29b-41d4-a716-446655440000",
      "deliveredAt": 1736669200000,
      "deliveredTo": "base64_node_id_that_received"
    }
  ],
  "failed": [
    {
      "bundleId": "550e8400-e29b-41d4-a716-446655440001",
      "reason": "expired",
      "failedAt": 1736669200000
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "acknowledged": 1,
  "notFound": 0
}
```

---

### 3.4 Batch Fetch Pre-Key Bundles

Get pre-key bundles for multiple offline users for mesh distribution.

**Endpoint:** `GET /api/v1/mesh/keys`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| userIds | string | Yes | Comma-separated user IDs |

**Response (200 OK):**

```json
{
  "keys": {
    "user_id_1": {
      "deviceId": 12345,
      "registrationId": 6789,
      "identityKey": "base64_32_bytes",
      "signedPreKey": {
        "keyId": 1,
        "publicKey": "base64_32_bytes",
        "signature": "base64_64_bytes"
      },
      "preKey": {
        "keyId": 42,
        "publicKey": "base64_32_bytes"
      }
    },
    "user_id_2": null
  },
  "serverTime": 1736668850000
}
```

**Notes:**
- Returns `null` for users with no registered devices
- Pre-keys are consumed on fetch (one-time use)

---

### 3.5 Register Mesh Node

Register a node as a gateway capable of bridging mesh ↔ server.

**Endpoint:** `POST /api/v1/mesh/nodes/register`

**Request Body:**

```json
{
  "nodeId": "base64_32_bytes_node_pubkey",
  "capabilities": 31,
  "publicEndpoint": "https://node.example.com:7847",
  "location": {
    "geoHash": "u4pruydqqvj",
    "accuracy": 100
  },
  "metadata": {
    "platform": "ios",
    "version": "1.0.0",
    "maxStorage": 104857600,
    "maxBandwidth": 10485760
  }
}
```

**Response (200 OK):**

```json
{
  "nodeId": "base64_32_bytes",
  "registered": true,
  "serverId": "server_assigned_id",
  "serverCertificate": "base64_server_cert"
}
```

---

### 3.6 Get Mesh Status

Get information about the known mesh network state.

**Endpoint:** `GET /api/v1/mesh/status`

**Response (200 OK):**

```json
{
  "activeGateways": 42,
  "pendingBundles": 1337,
  "avgDeliveryTime": 7200000,
  "meshHealth": "good",
  "nearbyNodes": [
    {
      "nodeId": "base64_32_bytes",
      "lastSeen": 1736668800000,
      "capabilities": 31,
      "geoHash": "u4pruydqqvj"
    }
  ],
  "serverTime": 1736668850000
}
```

---

### 3.7 Report Mesh Metrics

Report anonymized mesh metrics for network health monitoring.

**Endpoint:** `POST /api/v1/mesh/metrics`

**Request Body:**

```json
{
  "timestamp": 1736668850000,
  "metrics": {
    "peersDiscovered": 12,
    "peersConnected": 5,
    "bundlesStored": 234,
    "bundlesRelayed": 567,
    "bundlesDelivered": 89,
    "bundlesExpired": 23,
    "bytesTransferred": 1048576,
    "avgHopCount": 2.3,
    "deliverySuccessRate": 0.87
  }
}
```

**Response (200 OK):**

```json
{
  "received": true
}
```

---

## 4. WebSocket API

### 4.1 Connection

**Endpoint:** `wss://api.railgun.chat/api/v1/mesh/ws`

**Connection Headers:**

Same authentication headers as REST API.

### 4.2 Message Format

All WebSocket messages use JSON:

```json
{
  "type": "message_type",
  "id": "unique_message_id",
  "payload": { ... },
  "timestamp": 1736668850000
}
```

### 4.3 Server → Gateway Events

#### 4.3.1 New Bundle for Mesh

```json
{
  "type": "mesh:bundle",
  "id": "msg_123",
  "payload": {
    "bundle": {
      "bundleId": "...",
      "version": 1,
      "flags": 0,
      "priority": 2,
      "hopCount": 0,
      "maxHops": 10,
      "createdAt": 1736668800000,
      "expiresAt": 1736928000000,
      "sourceNode": "base64_server_node_id",
      "destinationType": 0,
      "destination": "base64_user_id",
      "payload": "base64_encrypted_envelope",
      "signature": "base64_signature"
    },
    "hints": {
      "lastKnownNode": "base64_node_id",
      "geoHash": "u4pruydqqvj"
    }
  },
  "timestamp": 1736668850000
}
```

#### 4.3.2 User Online Status Change

```json
{
  "type": "mesh:user_status",
  "id": "msg_124",
  "payload": {
    "userId": "user_id",
    "status": "online",
    "deviceId": 12345
  },
  "timestamp": 1736668850000
}
```

#### 4.3.3 Delivery Confirmation

```json
{
  "type": "mesh:delivered",
  "id": "msg_125",
  "payload": {
    "bundleId": "550e8400-e29b-41d4-a716-446655440000",
    "deliveredAt": 1736669200000,
    "deliveredVia": "direct"
  },
  "timestamp": 1736668850000
}
```

### 4.4 Gateway → Server Events

#### 4.4.1 Upload Bundle

```json
{
  "type": "mesh:upload",
  "id": "msg_200",
  "payload": {
    "bundle": { ... }
  },
  "timestamp": 1736668850000
}
```

**Response:**

```json
{
  "type": "mesh:upload_ack",
  "id": "msg_200",
  "payload": {
    "bundleId": "...",
    "status": "accepted"
  },
  "timestamp": 1736668850001
}
```

#### 4.4.2 Delivery Acknowledgment

```json
{
  "type": "mesh:ack",
  "id": "msg_201",
  "payload": {
    "bundleId": "550e8400-e29b-41d4-a716-446655440000",
    "deliveredAt": 1736669200000,
    "deliveredTo": "base64_node_id"
  },
  "timestamp": 1736668850000
}
```

#### 4.4.3 Subscribe to Users

```json
{
  "type": "mesh:subscribe",
  "id": "msg_202",
  "payload": {
    "userIds": ["user_1", "user_2", "user_3"]
  },
  "timestamp": 1736668850000
}
```

---

## 5. Error Codes

### 5.1 General Errors

| Code | HTTP | Description |
|------|------|-------------|
| AUTH_FAILED | 401 | Authentication failed |
| INVALID_SIGNATURE | 401 | Node signature invalid |
| TIMESTAMP_EXPIRED | 401 | Request timestamp too old |
| FORBIDDEN | 403 | Operation not permitted |
| NOT_FOUND | 404 | Resource not found |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

### 5.2 Bundle-Specific Errors

| Code | Description |
|------|-------------|
| BUNDLE_EXPIRED | Bundle TTL exceeded |
| BUNDLE_INVALID | Bundle format invalid |
| BUNDLE_TOO_LARGE | Bundle exceeds size limit |
| BUNDLE_DUPLICATE | Bundle already processed |
| DESTINATION_UNKNOWN | Destination user not found |
| SIGNATURE_INVALID | Bundle signature invalid |

---

## 6. Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /mesh/upload | 1000 bundles | 1 minute |
| GET /mesh/download | 100 requests | 1 minute |
| POST /mesh/ack | 1000 acks | 1 minute |
| GET /mesh/keys | 100 requests | 1 minute |
| WebSocket messages | 1000 messages | 1 minute |

---

## 7. Pagination

For endpoints returning lists, pagination uses cursor-based pagination:

**Request:**
```
GET /api/v1/mesh/download?limit=100&cursor=abc123
```

**Response:**
```json
{
  "bundles": [...],
  "hasMore": true,
  "nextCursor": "def456"
}
```

---

## 8. Webhooks (Future)

For gateways that can receive callbacks:

**Registration:**
```json
POST /api/v1/mesh/webhooks
{
  "url": "https://gateway.example.com/railgun/webhook",
  "events": ["bundle", "user_status"],
  "secret": "webhook_signing_secret"
}
```

**Webhook Payload:**
```json
{
  "event": "mesh:bundle",
  "timestamp": 1736668850000,
  "payload": { ... },
  "signature": "hmac_sha256_signature"
}
```

---

## 9. Server Node Identity

The server acts as a special node for creating bundles destined for the mesh:

```
Server Node ID: Well-known Ed25519 public key
Server Capabilities: 0xFF (all capabilities)
Server GeoHash: null (global)
```

Bundles created by the server have:
- `sourceNode` = Server Node ID
- `hopCount` = 0
- Valid signature from server's Ed25519 key

---

## 10. Example Flows

### 10.1 Message from Online User to Offline User

```
1. Online user sends message via normal API
2. Server detects recipient is offline
3. Server wraps message in bundle format
4. Server pushes bundle to connected gateways via WebSocket
5. Gateway injects bundle into local mesh
6. Bundle propagates through mesh
7. Eventually reaches node near recipient
8. Recipient's device receives and decrypts message
9. Recipient's device sends ACK back through mesh
10. ACK reaches gateway, forwarded to server
11. Server marks message as delivered
```

### 10.2 Message from Offline User to Online User

```
1. Offline user composes message
2. Device creates bundle with encrypted envelope
3. Bundle propagates through mesh
4. Gateway receives bundle
5. Gateway uploads bundle via POST /mesh/upload
6. Server extracts envelope, delivers to recipient
7. Server sends delivery confirmation to gateway
8. Gateway creates ACK bundle, injects into mesh
9. ACK propagates back to sender
10. Sender knows message was delivered
```

---

## 11. Implementation Notes

### 11.1 Server Requirements

- Redis for real-time gateway state
- PostgreSQL for bundle persistence
- Queue (Bull/BullMQ) for async processing
- WebSocket server with horizontal scaling (Redis pub/sub)

### 11.2 Gateway Requirements

- Persistent connection management
- Local bundle store (SQLite)
- Reconnection with exponential backoff
- Bundle deduplication

### 11.3 Security Considerations

- All bundles are end-to-end encrypted
- Server cannot read message contents
- Server can see metadata (timing, size, source, destination)
- Consider onion routing for high-privacy needs
