# Quick Start Guide - Rail Gun v0.1.0

## 🎯 Currently Running

| Service | URL | Port | Status |
|---------|-----|------|--------|
| **API** | http://localhost:3001 | 3001 | ✅ Running |
| **Frontend** | http://localhost:5173 | 5173 | ✅ Running |
| **WebSocket** | ws://localhost:3001 | 3001 | ✅ Active |

---

## 🚀 Quick Start

### 1. Open the Application
```bash
# Browser
open http://localhost:5173
```

### 2. Register/Login
- Create a new account
- Tokens are **automatically encrypted** using Electron's safeStorage
- No plain text tokens in localStorage ✨

### 3. Discover Users
- Click "New DM" button (or magnifying glass icon)
- Type a username
- Results appear in real-time with rate limiting

### 4. Start a DM
- Click on a user from search results
- Conversation opens automatically
- Messages are end-to-end encrypted

### 5. Send Messages
- Type encrypted message
- Send button
- Message appears in real-time (both participants)

---

## 🔐 Security Features

### Token Storage
```bash
# View encrypted token file (binary, not readable)
ls -la ~/Library/Application\ Support/Rail\ Gun/secure-storage.enc

# On macOS: Encrypted with Keychain
# On Windows: Encrypted with DPAPI
# On Linux: Encrypted with libsecret
```

### Message Encryption
- **Signal Protocol** (libsignal)
- **Forward secrecy** - Each message has unique key
- **Break-in recovery** - Compromise doesn't affect past messages
- **Double Ratchet** - State-of-the-art encryption

### Rate Limiting
- User search: 10 requests/min
- Exact lookup: 30 requests/min
- Prevents enumeration attacks

---

## 🧪 API Testing

### Health Check
```bash
curl http://localhost:3001/api/v1/health
```

### Register User
```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "securePassword123"
  }'
```

### Login
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "securePassword123"
  }'
```

### Search Users (requires auth token from login)
```bash
TOKEN="<your_access_token_here>"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/v1/users/search?query=bob"
```

### Start DM
```bash
TOKEN="<your_access_token_here>"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"bob"}' \
  "http://localhost:3001/api/v1/dms"
```

### List DMs
```bash
TOKEN="<your_access_token_here>"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/v1/dms"
```

---

## 📊 File Structure

```
Rail Gun/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── stores/authStore.ts (async secure storage)
│       │   ├── components/
│       │   │   ├── StartDmModal.tsx (user search)
│       │   │   ├── Sidebar.tsx (DM list)
│       │   │   └── ChatArea.tsx (unified messaging)
│       │   └── lib/
│       │       ├── secureTokenStore.ts (new!)
│       │       ├── api.ts (DM endpoints)
│       │       └── socket.ts (room subscription)
│       └── electron/
│           └── main.ts (safeStorage IPC handlers)
│
├── services/
│   └── api/
│       └── src/
│           ├── auth/rate-limit.guard.ts (new!)
│           ├── users/users.controller.ts (search endpoints)
│           ├── messages/
│           │   ├── dm.service.ts (new!)
│           │   ├── dm.controller.ts (new!)
│           │   └── dm-conversation.entity.ts (new!)
│           └── gateway/events.gateway.ts (room-based)
│
└── IMPLEMENTATION_SUMMARY.md (full documentation)
```

---

## 🔧 Development Commands

### Start Everything
```bash
npm run dev
```

### Build All
```bash
npm run build
```

### Type Check
```bash
npm run typecheck
```

### Run Tests
```bash
npm run test
```

### API Only
```bash
cd services/api && npm run dev
```

### Frontend Only
```bash
cd apps/desktop && npm run dev
```

---

## 🐛 Troubleshooting

### "Cannot find module" Error
- **Issue:** IDE showing stale errors for rate-limit.guard
- **Fix:** Restart TypeScript Server (Cmd+Shift+P → "TypeScript: Restart TS Server")
- **Note:** Actual compilation works fine (`tsc --noEmit` passes)

### Tokens Not Persisting
- **Check:** Is Electron safeStorage available?
  ```bash
  curl -s http://localhost:3001 # Check API running
  ```
- **Fallback:** localStorage used in browser dev mode
- **Storage:** File should exist at `~/Library/Application Support/Rail Gun/secure-storage.enc`

### WebSocket Connection Issues
- **Port 3001:** Make sure API is running
- **CORS:** Verify origin in `.env` (defaults to localhost:5173)
- **Clear Cache:** Hard refresh browser (Cmd+Shift+R)

### Messages Not Sending
- **Check:** Are you connected to API? (look for "Connected" indicator)
- **Auth:** Verify token is valid (expires after 1 hour)
- **Crypto:** Initialize successful? (watch browser console)

---

## 📚 Key Concepts

### DM Conversation ID
```
Format: {sortedUserIdA}:{sortedUserIdB}

Example:
- User A: abc123
- User B: xyz789
- Conversation: abc123:xyz789 (always sorted alphabetically)

✓ Ensures single conversation per pair
✓ No duplicate conversations
✓ Deterministic ID generation
```

### Room-Based Messaging
```
Channel: channel:{channelId}
  └─ Members: channel members
  └─ Messages: all channel messages
  └─ Typing: visible to all members

DM: dm:{conversationId}
  └─ Members: exactly 2 users
  └─ Messages: between those 2 users
  └─ Typing: visible only to peer
```

### Secure Storage Hierarchy
```
Browser (Not Electron)
  └─ localStorage (regular key-value)

Electron Desktop App
  └─ IPC Handler (secure-store-*)
      └─ OS Encryption (Keychain/DPAPI/libsecret)
          └─ Disk File (~/Library/...../secure-storage.enc)
```

---

## ✅ Testing Checklist

- [ ] Can register new account
- [ ] Can login with registered credentials
- [ ] Token is stored in secure storage (not localStorage)
- [ ] Can search for users by username
- [ ] Can start DM with searched user
- [ ] DM appears in Sidebar "Direct Messages"
- [ ] Can send message to DM
- [ ] Message appears in real-time for both users
- [ ] Message is encrypted (unreadable in API logs)
- [ ] Can load message history
- [ ] Can logout successfully (clears secure storage)

---

## 🎓 Learning Resources

### Implementation Details
See `IMPLEMENTATION_SUMMARY.md`:
- Full architecture diagrams
- API endpoint documentation
- Token flow explanation
- Security implementation details
- Entity relationship diagrams

### Code Examples

**User Search:**
```typescript
const results = await api.searchUsers("al");
// Returns: { users: [{ id, username, displayName, presence, ... }] }
```

**Start DM:**
```typescript
const dm = await api.startDm("alice");
// Returns: { conversationId, peer: { id, username, ... }, ... }
```

**Send Message:**
```typescript
await messagingService.sendDm(
  recipientId,
  "Hello Alice!" // Automatically encrypted
);
```

**Load History:**
```typescript
const messages = await messagingService.fetchDmHistory(userId, 50);
// Returns: [{ id, content, senderId, timestamp, ... }]
```

---

## 📞 Support

**Issue:** Read the IMPLEMENTATION_SUMMARY.md
**Error:** Check browser console (F12)
**Logs:** Terminal running `npm run dev`
**Database:** `docker-compose logs postgres`

---

**Rail Gun v0.1.0** - Secure. Encrypted. Real-time.
Last updated: December 9, 2025
