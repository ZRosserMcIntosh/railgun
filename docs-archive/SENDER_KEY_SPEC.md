# Sender Key Security Specification

## Overview

Rail Gun uses Signal's Sender Keys protocol for efficient group/channel encryption. This document specifies the security policies and lifecycle management for sender keys.

## Key Concepts

### Sender Keys
Each member of a channel has their own "sender key" for encrypting messages they send. Other members use this key to decrypt messages from that sender.

### Epochs
An "epoch" is a generation of sender keys. When membership changes or time-based rotation occurs, a new epoch begins with new keys.

### Distribution
Sender keys are distributed to members via encrypted DM (using X3DH + Double Ratchet), ensuring E2E security.

---

## Rekey Policies

### CRITICAL: Member Removal

**Policy**: ALWAYS rekey when a member is removed.

**Reason**: The removed member still has the old sender key and could decrypt future messages if the key isn't rotated.

```
Member A, B, C in channel
   │
   ▼ Member B removed
   │
   ▼ REKEY: All remaining members (A, C) generate new sender keys
   │
   ▼ B has old keys but won't receive new ones
   │
   ▼ B cannot decrypt new messages (epoch > their last seen)
```

### Member Addition

**Policy**: Do NOT rekey on member addition (by default).

**Reason**: New members should not have access to message history. They receive the current epoch key only.

```
Member A, B in channel (epoch 5)
   │
   ▼ Member C joins
   │
   ▼ NO REKEY: C receives epoch 5 key via DM
   │
   ▼ C can decrypt messages from epoch 5 onwards
   │
   ▼ C CANNOT decrypt epochs 1-4 (doesn't have those keys)
```

### Time-Based Rotation

**Policy**: Rekey at least every 7 days for active channels.

**Reason**: Limits exposure window if a key is compromised.

### Message Count Rotation

**Policy**: Rekey after 10,000 messages.

**Reason**: Reduces cryptographic wear on a single key.

---

## Replay Protection

### Per-Sender Monotonic Counters

Each message includes:
- `epochNumber`: Which generation of sender key
- `messageCounter`: Monotonically increasing per-sender per-epoch

```typescript
interface SenderKeyMessageEnvelope {
  ciphertext: string;
  senderUserId: string;
  epochNumber: number;      // MUST be >= last seen epoch
  messageCounter: number;   // MUST be > last seen counter for this epoch
  messageId: string;        // Hash for replay cache
  timestamp: string;        // For staleness checks
}
```

### Validation Rules

1. **Replay Cache**: Reject if `messageId` seen before
2. **Epoch Check**: Reject if `epochNumber < lastSeenEpoch` (outside grace period)
3. **Counter Check**: Reject if `messageCounter <= highestSeen[epoch]`

### Grace Period

Old epoch messages are accepted for 5 minutes to handle:
- Out-of-order delivery
- Clock skew between devices
- Network delays during rekey

After grace period, old epoch messages are rejected.

---

## History Access

### Default Policy: NONE

New members **cannot** decrypt messages from before they joined.

**Why**: 
- They don't have the old epoch keys
- Key escrow would compromise E2E security
- Server-stored history is still encrypted with old keys

### Alternative Policies (Not Recommended)

| Policy | Description | Security Impact |
|--------|-------------|-----------------|
| `none` | No history access | ✅ Strongest |
| `server_stored` | Server shares encrypted history | ⚠️ Requires key escrow |
| `limited` | Last N messages | ⚠️ Requires key escrow |
| `full` | All history | ❌ Defeats E2E |

**Recommendation**: Use `none` policy. If history sharing is needed, implement out-of-band key sharing with explicit user consent.

---

## Message Format

### Envelope Structure

```typescript
{
  // Encrypted payload
  ciphertext: string;           // Base64-encoded
  
  // Sender identification
  senderDeviceId: number;
  senderUserId: string;
  
  // Channel/group info
  channelId: string;
  distributionId: string;       // Sender key distribution ID
  
  // Replay protection
  epochNumber: number;          // Current sender key epoch
  messageCounter: number;       // Per-sender monotonic counter
  messageId: string;            // Unique message identifier
  
  // Timing
  timestamp: string;            // ISO 8601
}
```

### Example Flow

```
SENDER (Alice):
1. Check needsRekey() → false
2. Encrypt message with current sender key
3. Increment messageCounter (42 → 43)
4. Create envelope: { epoch: 3, counter: 43, ... }
5. Send to channel

RECEIVER (Bob):
1. Receive envelope: { epoch: 3, counter: 43, senderId: "alice" }
2. validateReceivedMessage():
   - Check replay cache → not found ✓
   - Check epoch → 3 >= lastSeen(3) ✓
   - Check counter → 43 > highestSeen(42) ✓
3. Decrypt with Alice's sender key (epoch 3)
4. Update state: highestSeen[3] = 43
5. Add messageId to replay cache
```

---

## Key Distribution Protocol

### Initial Distribution (Member Joins)

```
1. New member generates their sender key locally
2. Create SenderKeyDistributionMessage
3. For each existing member:
   a. Encrypt distribution via DM (X3DH session)
   b. Send encrypted distribution
4. Each existing member:
   a. Decrypt distribution
   b. Store sender key for new member
5. Existing members send THEIR distributions to new member
```

### Rekey Distribution (Epoch Change)

```
1. Trigger: member removed / max messages / max age
2. All remaining members generate NEW sender keys
3. Each member distributes new key to all others via DM
4. Old epoch is invalidated after grace period
```

---

## Implementation Checklist

- [x] Sender key generation per channel
- [x] Epoch tracking and versioning
- [x] Per-sender monotonic counters
- [x] Replay cache with size limit
- [x] Rekey on member removal
- [x] Time-based rotation check
- [x] Message count rotation check
- [x] Old epoch grace period
- [x] History access policy
- [ ] Sender key distribution via DM (Signal's SenderKeyDistributionMessage)
- [ ] Persistence of sender key state
- [ ] UI for key rotation events

---

## Security Considerations

### What Sender Keys PROTECT Against

✅ Server reading message content
✅ Replay attacks (with counter + cache)
✅ Removed member reading new messages
✅ Efficient group encryption (one encrypt, N decrypts)

### What Sender Keys DON'T PROTECT Against

❌ Compromised member reading messages (they have the key)
❌ Perfect forward secrecy within an epoch
❌ Metadata (who's in the group, when messages sent)
❌ Traffic analysis

### Compared to Pairwise Ratchets

| Property | Sender Keys | Pairwise Ratchets |
|----------|------------|-------------------|
| Efficiency | O(1) encrypt | O(N) encrypt |
| Forward Secrecy | Per-epoch | Per-message |
| Backward Secrecy | Yes | Yes |
| Complexity | Lower | Higher |
| Scalability | Better | Worse |

**Trade-off**: Sender keys sacrifice some forward secrecy for efficiency in large groups.

---

## References

- Signal Sender Keys: https://signal.org/docs/specifications/group-v2/
- MLS (Messaging Layer Security): https://messaginglayersecurity.rocks/
- Rail Gun Crypto Architecture: `/docs/CRYPTO_ARCHITECTURE.md`
