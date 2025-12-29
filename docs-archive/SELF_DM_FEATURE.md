# Self-DM Feature (Saved Messages)

## Overview

Users can now start a DM conversation with themselves, creating a private space for notes, reminders, testing, and saving important messages. This is similar to Telegram's "Saved Messages" or Slack's "You" channel.

## Features

### 💾 Saved Messages Button

When opening the "Start a Direct Message" modal, users see a prominent purple button at the top:

```
💾 Message Yourself (Saved Messages)
```

**Location**: Start DM Modal (Plus icon next to "Direct Messages")

### Special UI Indicators

**1. Sidebar DM List**
- Self-DM shows purple circle with 💾 icon instead of avatar
- No presence indicator (since you're always "online" to yourself)
- Label shows as "[Your Name] (You)"

**2. Chat Header**
- Purple "Saved Messages" badge next to your name
- Still shows E2EE indicator (messages are encrypted)

**3. Conversation ID Format**
- Regular DMs: `userId1:userId2` (sorted alphabetically)
- Self-DMs: `self:userId` (special format)

## Use Cases

1. **Personal Notes** - Quick scratchpad for thoughts and ideas
2. **Reminders** - Send yourself messages as reminders
3. **Link Storage** - Save important URLs for later
4. **Testing** - Test message formatting, attachments, etc.
5. **Cross-Device Sync** - Access your notes from any device (when multi-device is implemented)
6. **Drafts** - Draft messages before sending them to others

## Technical Implementation

### Frontend Changes

**StartDmModal.tsx**
```typescript
const handleStartSelfDm = async () => {
  if (!user) return;
  
  const result = await api.startDmById(user.id);
  
  addDmConversation({
    conversationId: result.conversationId,
    peerId: user.id,
    peerUsername: user.username,
    peerDisplayName: `${user.displayName} (You)`,
    peerPresence: 'ONLINE',
  });
  
  setCurrentDmUser(user.id);
};
```

**Sidebar.tsx**
```typescript
// Detect self-DM and show special icon
const isSelfDm = dm.peerId === user?.id;

{isSelfDm ? (
  <div className="w-8 h-8 rounded-full bg-purple-600">
    💾
  </div>
) : (
  // Regular avatar
)}
```

**ChatArea.tsx**
```typescript
// Show "Saved Messages" badge
{currentDm?.peerId === user?.id && (
  <span className="bg-purple-600 text-white px-2 py-0.5 rounded">
    Saved Messages
  </span>
)}
```

### Backend Changes

**dm.service.ts**

Removed the block on self-DMs:

```typescript
async startDmByUserId(currentUserId: string, targetUserId: string) {
  const isSelfDm = targetUserId === currentUserId;
  
  const conversationId = isSelfDm 
    ? `self:${currentUserId}`  // Special format
    : this.generateConversationId(currentUserId, targetUserId);
  
  // ... create conversation
}
```

**Key Changes:**
- ✅ Removed `Cannot start a DM with yourself` error
- ✅ Use special `self:userId` format for conversation IDs
- ✅ Both `startDm()` and `startDmById()` methods support self-DMs

### Database Schema

No schema changes required! Self-DMs use the existing `dm_conversations` table:

```sql
dm_conversations {
  conversationId: 'self:user-123',
  user1Id: 'user-123',
  user2Id: 'user-123',  -- Same user for both
  lastMessageAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Security Considerations

1. **End-to-End Encryption** - Self-DM messages are still E2E encrypted
2. **Server Blind** - Server cannot read messages, even to yourself
3. **Local Storage** - Messages decrypted only on your device
4. **Consistent Security** - Same security model as regular DMs

## User Experience

### Flow:

1. Click **+** icon next to "Direct Messages" in sidebar
2. See modal with:
   - 💾 **Message Yourself (Saved Messages)** button (purple)
   - Divider: "or search for a user"
   - Search input for other users
3. Click "Message Yourself" → Instantly opens self-DM
4. Self-DM appears in sidebar with 💾 icon
5. Chat header shows "[Your Name] (You)" + "Saved Messages" badge

### Visual Design:

- **Color**: Purple (#7C3AED) to distinguish from regular DMs
- **Icon**: 💾 (floppy disk) - universal "save" symbol
- **Badge**: Small purple pill badge saying "Saved Messages"
- **Priority**: Appears first in DM list (optional: can be pinned)

## Future Enhancements

- [ ] Pin self-DM to top of DM list
- [ ] Search within saved messages
- [ ] Organize with hashtags or folders
- [ ] Export saved messages
- [ ] Scheduled messages (send to yourself at specific time)
- [ ] Voice memos to self
- [ ] File attachments in saved messages
- [ ] Rich text formatting preview

## Comparison to Other Apps

| App | Feature Name | Icon | Notes |
|-----|-------------|------|-------|
| **Telegram** | Saved Messages | 💾 | Pinned at top, cloud synced |
| **Slack** | You (DM with yourself) | Profile pic | Appears in DM list |
| **Discord** | - | - | Not supported (workaround: create private server) |
| **Signal** | Note to Self | 📝 | Appears in conversation list |
| **WhatsApp** | - | - | Not supported (workaround: create group with only you) |
| **Rail Gun** | Saved Messages | 💾 | Purple theme, E2E encrypted |

## Testing Checklist

- [x] Can click "Message Yourself" button
- [x] Self-DM conversation is created
- [x] Self-DM appears in sidebar with 💾 icon
- [x] Clicking self-DM opens chat
- [x] Chat header shows "Saved Messages" badge
- [x] Can send messages to yourself
- [x] Messages are encrypted (same as regular DMs)
- [x] Messages persist across sessions
- [x] Conversation ID format is `self:userId`
- [x] Backend allows self-DMs (no error)
- [x] No presence indicator shown (you're always online)

## Files Modified

```
Frontend:
├── apps/desktop/src/components/
│   ├── StartDmModal.tsx       # Added "Message Yourself" button
│   ├── Sidebar.tsx            # Special 💾 icon for self-DM
│   └── ChatArea.tsx           # "Saved Messages" badge

Backend:
└── services/api/src/messages/
    └── dm.service.ts          # Allow self-DMs, special conversation ID
```

## Usage Statistics (Future)

Track these metrics:
- % of users who use Saved Messages
- Average messages per self-DM
- Most common time of day for self-messages
- Retention: do users keep using it?

---

**Status**: ✅ Implemented and Ready
**Version**: 0.1.0
**Date**: December 17, 2025
