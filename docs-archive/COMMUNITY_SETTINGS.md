# Community Settings Feature

## Overview

Comprehensive community/server management system allowing server owners and admins to configure all aspects of their community.

## Access

Click the **⚙️ Settings** icon next to the community name in the sidebar.

## Features

### 📋 Overview Tab

- **Community Icon**: Upload custom server icon (512x512px recommended)
- **Community Name**: Edit server name (max 100 chars)
- **Description**: Set server description (max 500 chars)
- **Invite Code**: View and regenerate invite codes for new members

### 🎭 Roles Tab

Manage roles and permissions with Discord-like system:

**Default Roles:**
- **Owner** (Red) - Full administrator access
- **Admin** (Orange) - Manage community, channels, roles, members
- **Moderator** (Green) - Manage messages, kick members
- **Member** (Gray) - Basic read/write permissions

**Role Management:**
- Create custom roles with unique colors
- Assign granular permissions per role
- Delete custom roles (cannot delete Owner/Member)
- Reorder roles by position

**Available Permissions:**
- `ADMINISTRATOR` - Full access (overrides all other permissions)
- `MANAGE_COMMUNITY` - Edit community settings
- `MANAGE_CHANNELS` - Create, edit, delete channels
- `MANAGE_ROLES` - Create, edit, delete roles
- `MANAGE_MEMBERS` - View and manage member list
- `INVITE_MEMBERS` - Generate invite links
- `KICK_MEMBERS` - Remove members
- `BAN_MEMBERS` - Ban members permanently
- `READ_MESSAGES` - View messages in channels
- `SEND_MESSAGES` - Send messages in channels
- `MANAGE_MESSAGES` - Delete others' messages

### 👥 Members Tab

View and manage all community members:

**Member List:**
- Avatar, display name, username
- Current role badges
- Join date

**Member Actions (for admins):**
- **Manage Roles**: Assign/remove roles from members
- **Kick**: Remove member from server

**Role Assignment Modal:**
- Check/uncheck roles for specific member
- Cannot assign Owner role (reserved for creator)
- Changes save immediately

### 📺 Channels Tab

Manage text and voice channels:

**Channel List:**
- Channel name with # prefix
- Description (if set)
- Edit button for admins

**Channel Actions:**
- Edit existing channels
- Create new channels (button at bottom)
- Reorder channels (TODO)
- Delete channels (TODO)

## Permission System

### Who Can Access Settings?

1. **Server Owner** - Full access to all tabs
2. **Users with `MANAGE_COMMUNITY`** - Access to most settings
3. **Regular Members** - Read-only view (if implemented)

### Role Hierarchy

- **Owner** always has highest permissions
- Roles are ordered by position number
- Users inherit permissions from all their roles
- `ADMINISTRATOR` permission grants all permissions

## UI/UX

### Design
- Dark theme matching Rail Gun aesthetic
- Modal-based interface for focused editing
- Tabbed navigation for organized sections
- Color-coded role badges
- Confirmation dialogs for destructive actions

### Accessibility
- Keyboard navigation support
- Clear labels and aria-attributes
- Visual feedback for all actions
- Error messages for validation

## Technical Implementation

### Components

```
components/settings/
├── CommunitySettingsModal.tsx  # Main settings modal with tabs
└── index.ts                    # Exports
```

### State Management

- **Local State**: Form inputs, tab selection, modal visibility
- **Zustand Store**: Community data, channels, members
- **API Integration**: Save changes to server

### API Endpoints (To Implement)

```typescript
// Community Management
PATCH /communities/:id              // Update community settings
POST  /communities/:id/icon         // Upload community icon
POST  /communities/:id/invite       // Regenerate invite code

// Role Management
POST   /communities/:id/roles       // Create role
PATCH  /communities/:id/roles/:roleId  // Update role
DELETE /communities/:id/roles/:roleId  // Delete role

// Member Management
GET    /communities/:id/members     // List members
POST   /communities/:id/members/:userId/roles  // Assign role
DELETE /communities/:id/members/:userId/roles/:roleId  // Remove role
DELETE /communities/:id/members/:userId  // Kick member
POST   /communities/:id/bans/:userId  // Ban member

// Channel Management
POST   /communities/:id/channels    // Create channel
PATCH  /communities/:id/channels/:channelId  // Update channel
DELETE /communities/:id/channels/:channelId  // Delete channel
```

## Usage Example

```tsx
import { CommunitySettingsModal } from '../components/settings';

// In your component
const [showSettings, setShowSettings] = useState(false);
const currentCommunity = useChatStore(state => 
  state.communities.find(c => c.id === state.currentCommunityId)
);

// Render
{showSettings && currentCommunity && (
  <CommunitySettingsModal
    community={currentCommunity}
    onClose={() => setShowSettings(false)}
  />
)}
```

## Security Considerations

1. **Permission Checks**: Always verify user permissions on backend
2. **Owner Protection**: Owner role cannot be transferred or removed
3. **Audit Logging**: Log all role/permission changes
4. **Rate Limiting**: Limit API calls for role/member updates
5. **Input Validation**: Sanitize all user inputs (names, descriptions)

## Future Enhancements

- [ ] Channel permissions (per-channel role overrides)
- [ ] Ban list management
- [ ] Audit log viewer
- [ ] Webhook integrations
- [ ] Server templates
- [ ] Vanity URLs
- [ ] Emoji management
- [ ] Role icons
- [ ] Member search/filter
- [ ] Bulk role assignment
- [ ] Export member list
- [ ] Server insights/analytics

## Screenshots

### Overview Tab
- Community icon upload
- Name and description editing
- Invite code management

### Roles Tab
- Role list with colors
- Permission checkboxes
- Create/edit/delete roles

### Members Tab
- Member list with role badges
- Role assignment modal
- Kick/ban actions

### Channels Tab
- Channel list
- Create channel button
- Edit channel settings
