# Rail Gun Pro Plan & Group Structures Implementation

**Last updated:** January 12, 2026  
**Status:** Implementation Specification  
**Scope:** Backend, Web, Desktop, iOS, Android

---

## Table of Contents

1. [Overview](#overview)
2. [Pro Plan ($7/month)](#pro-plan-7month)
3. [Group Structures](#group-structures)
4. [Public Groups](#public-groups)
5. [Paid Groups + Stripe Connect](#paid-groups--stripe-connect)
6. [Data Model Changes](#data-model-changes)
7. [API Endpoints](#api-endpoints)
8. [Cross-Platform Implementation](#cross-platform-implementation)
9. [iOS App Store Compliance](#ios-app-store-compliance)
10. [Migration Plan](#migration-plan)

---

## Overview

This document outlines the implementation of:

1. **Pro Plan** - $7/month subscription with enhanced limits
2. **Group Types** - Broadcast, Full, and Paid groups
3. **Public Groups** - Discoverable via @handle and QR codes
4. **Paid Groups** - Revenue sharing with 10% commission via Stripe Connect

### Critical Constraints

⚠️ **iOS In-App Purchase Requirement**: Apple requires IAP for digital content/features. Paid groups on iOS must use StoreKit. Stripe is allowed on web/desktop only.

---

## Pro Plan ($7/month)

### Updated Entitlements

| Feature | Free Tier | Pro Tier |
|---------|-----------|----------|
| **Message Length** | 500 characters | 2,000 characters |
| **Image Quality** | SD (1280px max) | HD (4096px max) |
| **Image Size** | 5 MB | 25 MB |
| **Video Duration** | 60 seconds | 5 minutes |
| **Video Size** | 50 MB | 500 MB |
| **File Uploads** | 100 MB | 500 MB |
| **Voice Participants** | 8 | 25 |
| **Audio Bitrate** | 32 kbps | 128 kbps |
| **Video Calling** | ❌ | ✅ |
| **Screen Sharing** | ❌ | ✅ |

### Capability Updates Required

Update `packages/shared/src/enums.ts`:

```typescript
/** Pro capabilities */
export enum Capability {
  HD_MEDIA = 'HD_MEDIA',
  LARGE_FILES = 'LARGE_FILES',
  VIDEO_CALLING = 'VIDEO_CALLING',
  LONG_VIDEO = 'LONG_VIDEO',
  SCREEN_SHARE = 'SCREEN_SHARE',
  EXTENDED_MESSAGE = 'EXTENDED_MESSAGE', // NEW: 2000 char messages
  HD_VIDEO = 'HD_VIDEO', // NEW: Higher resolution video
  PRIORITY_RELAY = 'PRIORITY_RELAY',
}
```

Update `apps/desktop/src/billing/capabilities.ts`:

```typescript
export const FREE_TIER_LIMITS = {
  MAX_MESSAGE_LENGTH: 500,           // characters
  MAX_IMAGE_DIMENSION: 1280,         // pixels
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,  // 5 MB
  MAX_VIDEO_SECONDS: 60,             // 1 minute
  MAX_VIDEO_BYTES: 50 * 1024 * 1024, // 50 MB
  MAX_FILE_BYTES: 100 * 1024 * 1024, // 100 MB
  MAX_VOICE_PARTICIPANTS: 8,
  MAX_AUDIO_BITRATE: 32,             // kbps
  VIDEO_CALLING_ENABLED: false,
  SCREEN_SHARE_ENABLED: false,
} as const;

export const PRO_TIER_LIMITS = {
  MAX_MESSAGE_LENGTH: 2000,            // characters
  MAX_IMAGE_DIMENSION: 4096,           // pixels
  MAX_IMAGE_BYTES: 25 * 1024 * 1024,   // 25 MB
  MAX_VIDEO_SECONDS: 300,              // 5 minutes
  MAX_VIDEO_BYTES: 500 * 1024 * 1024,  // 500 MB
  MAX_FILE_BYTES: 500 * 1024 * 1024,   // 500 MB
  MAX_VOICE_PARTICIPANTS: 25,
  MAX_AUDIO_BITRATE: 128,              // kbps
  VIDEO_CALLING_ENABLED: true,
  SCREEN_SHARE_ENABLED: true,
} as const;
```

---

## Group Structures

### Core Concepts

Groups are an extension of the existing `communities` system with additional policies.

### Group Types

| Type | Description | Post Policy |
|------|-------------|-------------|
| **Broadcast** | Passive/announcement channel | Owner + authorized only |
| **Full** | Discord-style chat | All members |
| **Paid** | Requires payment to join | Configurable |

### Roles & Permissions

Extend the existing `Permission` enum:

```typescript
export enum Permission {
  // Existing permissions...
  
  // NEW: Group-specific permissions
  POST_MESSAGES = 'POST_MESSAGES',       // Can post in broadcast groups
  APPROVE_MEMBERS = 'APPROVE_MEMBERS',   // Can approve join requests
  MANAGE_PAYMENTS = 'MANAGE_PAYMENTS',   // Can view payment info
}
```

### Role Hierarchy

| Role | Level | Default Permissions |
|------|-------|---------------------|
| Owner | 999 | ADMINISTRATOR |
| Admin | 100 | MANAGE_*, POST_MESSAGES |
| Moderator | 50 | MANAGE_MESSAGES, KICK_MEMBERS, POST_MESSAGES |
| Member | 0 | READ_MESSAGES, SEND_MESSAGES (if allowed) |
| Muted | -1 | READ_MESSAGES only |

---

## Public Groups

### Discovery Mechanisms

1. **@handle** - Unique, URL-safe identifier (e.g., `@railgun-community`)
2. **QR Code** - Links to `railgun://join/{handle}` or web fallback
3. **Search/Directory** - Optional discoverable listing

### Group Visibility Flags

```typescript
interface GroupVisibility {
  isPublic: boolean;           // Listed in search/directory
  joinPolicy: JoinPolicy;      // How users join
  postPolicy: PostPolicy;      // Who can send messages
  discoverable: boolean;       // Show in recommendations
  handle?: string;             // Unique @handle (nullable)
}

enum JoinPolicy {
  OPEN = 'OPEN',                    // Anyone can join instantly
  APPROVAL_REQUIRED = 'APPROVAL',   // Requires owner/admin approval
  INVITE_ONLY = 'INVITE_ONLY',      // Requires invite code
  PAID = 'PAID',                    // Requires payment
}

enum PostPolicy {
  OPEN = 'OPEN',                    // All members can post
  OWNER_ONLY = 'OWNER_ONLY',        // Only owner can post
  ROLE_BASED = 'ROLE_BASED',        // POST_MESSAGES permission required
}
```

### Deep Links

| Platform | URL Format |
|----------|------------|
| Universal | `https://railgun.app/join/{handle}` |
| App Link | `railgun://join/{handle}` |
| QR Code | Either format, with UTM tracking |

---

## Paid Groups + Stripe Connect

### Business Model

- **Commission**: 10% of all paid group subscriptions
- **Payment Processor**: Stripe Connect (Standard accounts)
- **Payout**: Direct to group owner's Stripe account

### Payment Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Member    │────▶│  Railgun    │────▶│   Stripe    │
│  Pays $10   │     │  Backend    │     │   Connect   │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                    │
                           │ Record payment     │ $9 to owner
                           │ Grant membership   │ $1 to platform
                           │                    │
                    ┌──────▼──────┐     ┌──────▼──────┐
                    │   Database  │     │ Owner Bank  │
                    └─────────────┘     └─────────────┘
```

### Stripe Connect Setup

1. Owner connects Stripe account (OAuth flow)
2. Create `GroupPlan` with Stripe Product/Price IDs
3. Members purchase via Stripe Checkout (web) or IAP (iOS)
4. Backend activates membership on webhook/receipt

### iOS App Store Compliance

⚠️ **Apple's Guidelines** require In-App Purchase for:
- Unlocking features or functionality
- Accessing content
- Subscriptions

**Solution**: Dual payment system

| Platform | Payment Method | Implementation |
|----------|---------------|----------------|
| iOS | StoreKit IAP | Create IAP products mirroring group prices |
| Android | Google Play Billing | Similar to iOS |
| Web/Desktop | Stripe Checkout | Direct Stripe integration |

**Backend Unification**: Single `GroupMembership` table tracks all sources:

```typescript
enum PaymentSource {
  STRIPE = 'stripe',
  APPLE_IAP = 'apple_iap',
  GOOGLE_PLAY = 'google_play',
  PROMO = 'promo',  // Free/gifted access
}
```

---

## Data Model Changes

### New Tables

#### `group_plans` - Pricing for paid groups

```sql
CREATE TABLE group_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  
  -- Pricing
  price_cents INTEGER NOT NULL,           -- Price in cents (e.g., 999 = $9.99)
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  interval VARCHAR(20) NOT NULL,          -- 'one_time', 'monthly', 'yearly'
  
  -- Stripe integration
  stripe_product_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  
  -- Apple IAP integration
  apple_product_id VARCHAR(255),          -- App Store product ID
  
  -- Google Play integration
  google_product_id VARCHAR(255),
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  
  UNIQUE(community_id)
);
```

#### `group_memberships` - Paid membership tracking

```sql
CREATE TABLE group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  group_plan_id UUID REFERENCES group_plans(id),
  
  -- Payment info
  payment_source VARCHAR(20) NOT NULL,    -- 'stripe', 'apple_iap', 'google_play', 'promo'
  external_subscription_id VARCHAR(255),  -- Stripe subscription ID or IAP transaction ID
  
  -- Status
  status VARCHAR(20) NOT NULL,            -- 'active', 'past_due', 'canceled', 'expired'
  
  -- Timestamps
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP,
  canceled_at TIMESTAMP,
  
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, community_id)
);
```

#### `stripe_connect_accounts` - Owner Stripe accounts

```sql
CREATE TABLE stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  stripe_account_id VARCHAR(255) NOT NULL,
  account_type VARCHAR(20) NOT NULL DEFAULT 'standard',
  
  -- Onboarding status
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  
  UNIQUE(user_id),
  UNIQUE(stripe_account_id)
);
```

#### `group_join_requests` - Approval queue

```sql
CREATE TABLE group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  
  message TEXT,  -- Optional message from requester
  
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, community_id)
);
```

### Schema Updates to Existing Tables

#### `communities` - Add group policy fields

```sql
ALTER TABLE communities ADD COLUMN handle VARCHAR(32) UNIQUE;
ALTER TABLE communities ADD COLUMN join_policy VARCHAR(20) NOT NULL DEFAULT 'INVITE_ONLY';
ALTER TABLE communities ADD COLUMN post_policy VARCHAR(20) NOT NULL DEFAULT 'OPEN';
ALTER TABLE communities ADD COLUMN is_discoverable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE communities ADD COLUMN group_type VARCHAR(20) NOT NULL DEFAULT 'FULL';

-- Index for handle lookups
CREATE INDEX idx_communities_handle ON communities(handle) WHERE handle IS NOT NULL;

-- Index for public/discoverable groups
CREATE INDEX idx_communities_discoverable ON communities(is_discoverable, is_public) WHERE is_discoverable = true;
```

---

## API Endpoints

### Pro Plan Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/entitlements` | Get current user's entitlements |
| GET | `/billing/status` | Get subscription status |
| POST | `/billing/checkout` | Create Stripe Checkout session |
| POST | `/billing/portal` | Create customer portal session |

### Group Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/groups` | Create a new group |
| GET | `/groups/:id` | Get group details |
| PATCH | `/groups/:id` | Update group settings |
| DELETE | `/groups/:id` | Delete group (owner only) |
| GET | `/groups/:id/policies` | Get join/post policies |
| PATCH | `/groups/:id/policies` | Update policies |

### Group Discovery Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/groups/discover` | List discoverable groups |
| GET | `/groups/handle/:handle` | Get group by @handle |
| POST | `/groups/:id/join` | Request to join |
| GET | `/groups/:id/join-requests` | List pending requests |
| POST | `/groups/:id/join-requests/:requestId/approve` | Approve request |
| POST | `/groups/:id/join-requests/:requestId/reject` | Reject request |

### Paid Groups Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/groups/:id/plan` | Create/update group plan |
| GET | `/groups/:id/plan` | Get group plan details |
| DELETE | `/groups/:id/plan` | Remove paid requirement |
| POST | `/groups/:id/subscribe` | Start subscription (Stripe) |
| POST | `/groups/:id/verify-purchase` | Verify IAP receipt (iOS/Android) |
| GET | `/groups/:id/membership` | Get membership status |

### Stripe Connect Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/stripe/connect/authorize` | Start OAuth flow |
| GET | `/stripe/connect/callback` | OAuth callback |
| GET | `/stripe/connect/status` | Get account status |
| POST | `/stripe/connect/dashboard` | Get dashboard link |

### Message Enforcement

The message send endpoint must enforce limits:

```typescript
// POST /channels/:id/messages
async sendMessage(channelId: string, content: string, userId: string) {
  const user = await this.usersService.getUser(userId);
  const entitlements = await this.billingService.getEntitlements(userId);
  
  const maxLength = entitlements.hasPro 
    ? PRO_TIER_LIMITS.MAX_MESSAGE_LENGTH 
    : FREE_TIER_LIMITS.MAX_MESSAGE_LENGTH;
  
  if (content.length > maxLength) {
    throw new BadRequestException(
      `Message exceeds ${maxLength} character limit. ` +
      `Upgrade to Pro for ${PRO_TIER_LIMITS.MAX_MESSAGE_LENGTH} characters.`
    );
  }
  
  // Check post policy for groups
  const channel = await this.channelsService.getChannel(channelId);
  const community = await this.communitiesService.getCommunity(channel.communityId);
  
  if (community.postPolicy !== 'OPEN') {
    const canPost = await this.communitiesService.canUserPost(community.id, userId);
    if (!canPost) {
      throw new ForbiddenException('You do not have permission to post in this group');
    }
  }
  
  // Continue with message creation...
}
```

---

## Cross-Platform Implementation

### Backend (`services/api/`)

1. **Create migrations** for new tables
2. **Create entities**: `GroupPlan`, `GroupMembership`, `StripeConnectAccount`, `GroupJoinRequest`
3. **Create services**: `GroupPlanService`, `GroupMembershipService`, `StripeConnectService`
4. **Update CommunitiesService** with policy enforcement
5. **Add controllers** for new endpoints
6. **Implement webhooks** for Stripe Connect and IAP

### Desktop/Web (`apps/desktop/`, `apps/web/`)

1. **Update billing store** with new limits
2. **Add message length validation** in compose UI
3. **Create group settings UI** for policies
4. **Add public group discovery** page
5. **Implement QR code generator** for group handles
6. **Add Stripe Checkout integration** for paid groups

### iOS (`railgun-ios/`)

1. **Create entitlements system** mirroring desktop
2. **Implement StoreKit 2** for Pro and paid groups
3. **Add group policy models**
4. **Create join flow UI** with payment handling
5. **Implement deep link handling** for `railgun://join/{handle}`

#### iOS StoreKit Products (App Store Connect)

| Product ID | Type | Price |
|------------|------|-------|
| `com.railgun.pro.monthly` | Auto-renewable | $6.99 |
| `com.railgun.pro.annual` | Auto-renewable | $69.99 |
| `com.railgun.group.tier1` | Auto-renewable | $0.99/mo |
| `com.railgun.group.tier2` | Auto-renewable | $4.99/mo |
| `com.railgun.group.tier3` | Auto-renewable | $9.99/mo |

### Android (`railgun-android/`)

1. **Create entitlements system** mirroring desktop
2. **Implement Google Play Billing** for Pro and paid groups
3. **Add group policy models**
4. **Create join flow UI** with payment handling
5. **Implement deep link handling** via App Links

---

## iOS App Store Compliance

### App Store Guidelines Summary

Per [App Store Review Guidelines 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase):

> If you want to unlock features or functionality within your app, you must use in-app purchase.

### Compliance Strategy

1. **Pro subscriptions**: Use StoreKit on iOS, Stripe on web/desktop
2. **Paid groups**: 
   - Create pre-defined IAP tiers ($0.99, $4.99, $9.99, etc.)
   - Group owners select from available tiers
   - Apple takes 15-30%, so adjust commission accordingly
3. **Reader apps exception**: Does NOT apply (we're not a "reader" app)

### Revenue Implications

| Channel | User Pays | Platform Gets | Owner Gets |
|---------|-----------|---------------|------------|
| Web/Desktop (Stripe) | $10 | $1 (10%) | $9 |
| iOS (IAP 30%) | $10 | $3 (Apple) + $0.70 (7% of net) | $6.30 |
| iOS (IAP 15% small biz) | $10 | $1.50 (Apple) + $0.85 (10% of net) | $7.65 |

### Implementation Notes

```swift
// iOS - Purchase handling
import StoreKit

class GroupPurchaseManager {
    func purchaseGroupAccess(groupId: String, productId: String) async throws {
        let product = try await Product.products(for: [productId]).first!
        let result = try await product.purchase()
        
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            
            // Send receipt to backend for verification
            try await APIClient.shared.verifyGroupPurchase(
                groupId: groupId,
                transactionId: transaction.id.description,
                receipt: // JWS transaction
            )
            
            await transaction.finish()
            
        case .pending, .userCancelled:
            break
        }
    }
}
```

---

## Migration Plan

### Phase 1: Backend Foundation (Week 1-2)

- [ ] Create database migrations
- [ ] Implement entity classes
- [ ] Create group policy services
- [ ] Update message validation
- [ ] Add basic API endpoints

### Phase 2: Web/Desktop (Week 2-3)

- [ ] Update billing capabilities
- [ ] Add message length validation UI
- [ ] Create group settings modal
- [ ] Implement policy selection
- [ ] Add public group discovery

### Phase 3: Stripe Connect (Week 3-4)

- [ ] Set up Stripe Connect in dashboard
- [ ] Implement OAuth flow
- [ ] Create checkout for paid groups
- [ ] Implement webhooks
- [ ] Test payout flow

### Phase 4: iOS Implementation (Week 4-6)

- [ ] Create IAP products in App Store Connect
- [ ] Implement StoreKit 2 integration
- [ ] Add receipt verification endpoint
- [ ] Create join flow UI
- [ ] Submit for App Review

### Phase 5: Android Implementation (Week 5-7)

- [ ] Create IAP products in Play Console
- [ ] Implement Google Play Billing
- [ ] Add purchase verification
- [ ] Create join flow UI
- [ ] Submit for review

### Phase 6: QA & Launch (Week 7-8)

- [ ] End-to-end testing all platforms
- [ ] Cross-platform entitlement sync testing
- [ ] Payment flow testing
- [ ] Documentation updates
- [ ] Staged rollout

---

## Appendix: Implementation Checklist

### Implementation Progress (Updated January 12, 2026)

#### ✅ COMPLETED

**Backend:**
- ✅ `services/api/src/groups/entities/group-plan.entity.ts`
- ✅ `services/api/src/groups/entities/group-membership.entity.ts`
- ✅ `services/api/src/groups/entities/stripe-connect-account.entity.ts`
- ✅ `services/api/src/groups/entities/group-join-request.entity.ts`
- ✅ `services/api/src/groups/groups.service.ts`
- ✅ `services/api/src/groups/groups.controller.ts`
- ✅ `services/api/src/groups/stripe-connect.service.ts`
- ✅ `services/api/src/groups/groups.module.ts`
- ✅ `services/api/src/groups/migrations/1736700000000-AddGroupPoliciesAndPaidGroups.ts`
- ✅ `services/api/src/communities/community.entity.ts` - Added group policy fields
- ✅ `services/api/src/app.module.ts` - Registered GroupsModule

**Shared:**
- ✅ `packages/shared/src/types/groups.ts`
- ✅ `packages/shared/src/enums.ts` - Added new permissions

**Desktop:**
- ✅ `apps/desktop/src/components/groups/GroupDiscovery.tsx`
- ✅ `apps/desktop/src/components/groups/GroupSettings.tsx`
- ✅ `apps/desktop/src/components/groups/index.ts`
- ✅ `apps/desktop/src/stores/groupsStore.ts`
- ✅ `apps/desktop/src/billing/capabilities.ts` - Updated with new limits

**iOS:**
- ✅ `RailGun/Core/Models/GroupModels.swift`
- ✅ `RailGun/Core/Billing/Entitlements.swift`
- ✅ `RailGun/Core/Network/GroupsService.swift`
- ✅ `RailGun/Core/Network/APIClient.swift` - Added public request methods

**Android:**
- ✅ `app/src/main/java/com/railgun/android/data/model/GroupModels.kt`
- ✅ `app/src/main/java/com/railgun/android/data/model/EntitlementModels.kt`
- ✅ `app/src/main/java/com/railgun/android/data/api/RailgunApi.kt` - Added group endpoints

#### 🔄 IN PROGRESS / REMAINING

**Backend:**
- 🔲 `services/api/src/groups/iap-verification.service.ts` - Apple/Google receipt verification
- 🔲 Run database migration
- 🔲 Add message length validation to messages service

**Desktop:**
- 🔲 Add GroupDiscovery to routing
- 🔲 Add groups navigation item to sidebar
- 🔲 Integrate group settings into community settings modal
- 🔲 Add message length validation to MessageComposer

**iOS:**
- 🔲 `RailGun/Core/Billing/StoreKitManager.swift` - StoreKit 2 implementation
- 🔲 `RailGun/Features/Groups/GroupDiscoveryView.swift`
- 🔲 `RailGun/Features/Groups/JoinGroupView.swift`
- 🔲 `RailGun/Features/Groups/GroupSettingsView.swift`
- 🔲 Add to Xcode project file

**Android:**
- 🔲 `app/src/main/java/com/railgun/android/billing/BillingManager.kt` - Play Billing
- 🔲 `app/src/main/java/com/railgun/android/ui/groups/GroupDiscoveryScreen.kt`
- 🔲 `app/src/main/java/com/railgun/android/ui/groups/JoinGroupScreen.kt`
- 🔲 Add GroupsRepository for data layer

**Configuration:**
- 🔲 Set up Stripe Connect in Stripe Dashboard
- 🔲 Create App Store Connect IAP products
- 🔲 Create Google Play Console IAP products
- 🔲 Configure webhook endpoints

---

### Files Reference (Original Checklist)

**Backend:**
- `services/api/src/groups/entities/group-plan.entity.ts`
- `services/api/src/groups/entities/group-membership.entity.ts`
- `services/api/src/groups/entities/stripe-connect-account.entity.ts`
- `services/api/src/groups/entities/group-join-request.entity.ts`
- `services/api/src/groups/groups.service.ts`
- `services/api/src/groups/groups.controller.ts`
- `services/api/src/groups/stripe-connect.service.ts`
- `services/api/src/groups/stripe-connect.controller.ts`
- `services/api/src/groups/iap-verification.service.ts`
- `services/api/src/groups/migrations/*.ts`

**Shared:**
- `packages/shared/src/types/groups.ts`

**Desktop:**
- `apps/desktop/src/components/groups/GroupPoliciesModal.tsx`
- `apps/desktop/src/components/groups/PublicGroupCard.tsx`
- `apps/desktop/src/components/groups/GroupDiscoveryPage.tsx`
- `apps/desktop/src/components/groups/JoinGroupModal.tsx`
- `apps/desktop/src/components/groups/PaidGroupCheckout.tsx`
- `apps/desktop/src/stores/groupsStore.ts`

**iOS:**
- `RailGun/Core/Billing/EntitlementManager.swift`
- `RailGun/Core/Billing/StoreKitManager.swift`
- `RailGun/Core/Models/GroupModels.swift`
- `RailGun/Features/Groups/GroupDiscoveryView.swift`
- `RailGun/Features/Groups/JoinGroupView.swift`
- `RailGun/Features/Groups/GroupSettingsView.swift`

**Android:**
- `app/src/main/java/com/railgun/android/billing/EntitlementManager.kt`
- `app/src/main/java/com/railgun/android/billing/BillingManager.kt`
- `app/src/main/java/com/railgun/android/data/model/GroupModels.kt`
- `app/src/main/java/com/railgun/android/ui/groups/GroupDiscoveryScreen.kt`
- `app/src/main/java/com/railgun/android/ui/groups/JoinGroupScreen.kt`

### Files to Modify

**Backend:**
- `services/api/src/communities/communities.service.ts` - Add policy checks
- `services/api/src/communities/community.entity.ts` - Add new columns
- `services/api/src/messages/messages.service.ts` - Add length validation
- `packages/shared/src/enums.ts` - Add new enums

**Desktop:**
- `apps/desktop/src/billing/capabilities.ts` - Update limits
- `apps/desktop/src/stores/billingStore.ts` - Add new checks
- `apps/desktop/src/components/chat/MessageComposer.tsx` - Length validation
- `apps/desktop/src/components/settings/CommunitySettingsModal.tsx` - Add policies tab

**iOS:**
- `RailGun/Core/Models/Models.swift` - Add group models
- `RailGun/Core/Network/APIClient.swift` - Add group endpoints
- `RailGun/Features/Chat/ChatView.swift` - Length validation

**Android:**
- `app/src/main/java/com/railgun/android/data/model/ChatModels.kt` - Add group models
- `app/src/main/java/com/railgun/android/data/api/ApiService.kt` - Add group endpoints
- `app/src/main/java/com/railgun/android/ui/chat/ChatScreen.kt` - Length validation
