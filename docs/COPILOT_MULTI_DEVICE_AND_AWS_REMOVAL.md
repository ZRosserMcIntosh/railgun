# Copilot Task List: Multi-Device Messaging Fix + AWS Removal

**Date:** January 17, 2026  
**Priority:** CRITICAL  
**Scope:** Full cross-platform audit and infrastructure migration

---

## Executive Summary

Two critical issues need resolution:

1. **Multi-device messaging is broken**: Messages between devices fail because of hardcoded `deviceId=1`, single-envelope storage, and missing per-device routing.
2. **AWS dependency removal**: Migrate all infrastructure to Fly.io and remove AWS-specific code/config.

This document provides comprehensive Copilot instructions for fixing both issues.

---

## Part 1: Audit & Baseline

### 1.1 Inventory All deviceId=1 Hardcoding

**Files with known `deviceId=1` issues:**
- `apps/desktop/src/crypto/RailGunCrypto.ts` (line 258)
- `apps/desktop/src/crypto/SignalWrapper.ts` (line 517)
- `apps/desktop/electron/crypto-ipc.ts` (line 211)
- `services/api/src/communities/channels.controller.ts` (line 156)
- `apps/desktop/src/crypto/__tests__/crypto.e2e.test.ts` (line 120)

**Action:**
```bash
# Run in workspace root to find all instances
rg "deviceId\s*=\s*1" --type ts --type swift --type kotlin
rg "deviceId.*TODO" --type ts
```

Document findings in `docs/CROSS_PLATFORM_REVIEW.md` under a new "Multi-Device Audit" section.

### 1.2 Map Message Send/Receive Paths

**Desktop Path:**
1. `messagingService.ts:sendMessage()` → encrypts message
2. `RailGunCrypto.ts:encryptDm()` → uses hardcoded `deviceId=1` for recipient
3. `socket.ts` → sends via WebSocket
4. `events.gateway.ts:handleMessage()` → stores single envelope
5. `messages.service.ts:create()` → saves to DB with one `encryptedEnvelope`
6. Broadcast to DM room → only reaches clients that have joined room

**iOS Path:**
1. `CryptoManager.swift:encrypt()` → generates envelope
2. `WebSocketManager.swift` → sends message
3. Server stores/routes as above

**Android Path:**
1. `CryptoManager.kt:encryptMessage()` → generates envelope
2. `WebSocketManager.kt` → sends message
3. Server stores/routes as above

**Gaps identified:**
- [ ] All platforms target only one recipient device
- [ ] No fan-out to sender's other devices
- [ ] DMs only delivered if recipient has joined the DM room
- [ ] Channel sender-key distribution is per-user, not per-device

### 1.3 Verify DM Room Joining

**Current behavior in `Sidebar.tsx`:**
- DMs are fetched on mount (line ~113)
- **DM rooms are NOT auto-joined** on login
- User must click on a DM conversation to join the room
- This means real-time delivery fails for unopened conversations

**Fix required:** Auto-join all DM rooms after login, OR route DMs by user socket instead of room.

### 1.4 Document Envelope Shape Mismatches

**Current shapes:**

`messagingService.ts` EncryptedEnvelope:
```typescript
interface EncryptedEnvelope {
  type: 'dm' | 'channel';
  ciphertext: string;
  senderDeviceId: number;
  distributionId?: string;
  registrationId?: number;
  messageType?: 'prekey' | 'message';
}
```

`message.entity.ts` stores:
```typescript
encryptedEnvelope: string; // Single JSON blob
```

**Required for multi-device:**
```typescript
interface PerDeviceEnvelope {
  recipientDeviceId: number;
  ciphertext: string;
  messageType: 'prekey' | 'message';
}

interface MultiDeviceMessage {
  type: 'dm' | 'channel';
  senderDeviceId: number;
  envelopes: PerDeviceEnvelope[]; // One per recipient device
  registrationId?: number;
  distributionId?: string;
}
```

---

## Part 2: Protocol & Shared Types

### 2.1 Bump Protocol Version

**File:** `packages/shared/src/enums.ts`

```typescript
// Change from:
export const PROTOCOL_VERSION = 1;

// To:
export const PROTOCOL_VERSION = 2;

// Add version enum for clarity
export enum ProtocolVersion {
  V1_SINGLE_ENVELOPE = 1,
  V2_PER_DEVICE_ENVELOPES = 2,
}
```

### 2.2 Update Shared DTOs

**File:** `packages/shared/src/types/index.ts` or create `packages/shared/src/types/messaging.types.ts`

```typescript
/** Per-device encrypted envelope */
export interface DeviceEnvelope {
  /** Target device ID */
  recipientDeviceId: number;
  /** Base64 ciphertext encrypted for this device */
  ciphertext: string;
  /** 'prekey' for initial message, 'message' for subsequent */
  messageType: 'prekey' | 'message';
}

/** V2 DM message with per-device envelopes */
export interface EncryptedDmMessageV2 {
  type: 'dm';
  /** Sender's device ID */
  senderDeviceId: number;
  /** Sender's registration ID (for prekey messages) */
  registrationId?: number;
  /** Protocol version */
  protocolVersion: 2;
  /** Per-recipient-device envelopes */
  envelopes: DeviceEnvelope[];
}

/** V1 backward-compat single envelope (deprecated) */
export interface EncryptedDmMessageV1 {
  type: 'dm';
  senderDeviceId: number;
  ciphertext: string;
  messageType?: 'prekey' | 'message';
  registrationId?: number;
  protocolVersion?: 1;
}

export type EncryptedDmMessage = EncryptedDmMessageV1 | EncryptedDmMessageV2;
```

### 2.3 Add Backward Compatibility Handling

**File:** `apps/desktop/src/lib/messagingService.ts`

```typescript
// In decryptMessage():
async decryptMessage(serverMessage: ServerMessage): Promise<DecryptedMessage> {
  const envelope = JSON.parse(serverMessage.encryptedEnvelope);
  
  // Detect version
  const isV2 = envelope.protocolVersion === 2 && Array.isArray(envelope.envelopes);
  
  if (isV2) {
    // V2: Find envelope for our device
    const myDeviceId = this.getDeviceId();
    const myEnvelope = envelope.envelopes.find(
      (e: DeviceEnvelope) => e.recipientDeviceId === myDeviceId
    );
    if (!myEnvelope) {
      throw new Error('No envelope for this device');
    }
    return this.decryptEnvelope(serverMessage.senderId, myEnvelope, envelope.senderDeviceId);
  } else {
    // V1: Legacy single envelope
    return this.decryptLegacyEnvelope(serverMessage.senderId, envelope);
  }
}
```

**File:** `services/api/src/messages/messages.service.ts`

```typescript
// In create():
// Accept both V1 and V2 formats, store as-is
// The client handles version detection on decrypt
```

---

## Part 3: Server - Device Identity & Validation

### 3.1 Server-Assigned Device IDs

**File:** `services/api/src/crypto/crypto.service.ts`

```typescript
/**
 * Register a new device with server-assigned unique deviceId.
 */
async registerDevice(userId: string, dto: RegisterKeysDto): Promise<DeviceEntity> {
  // Find the highest existing deviceId for this user
  const existingDevices = await this.deviceRepository.find({
    where: { userId },
    order: { deviceId: 'DESC' },
  });
  
  // Assign next available deviceId (1, 2, 3, ...)
  // If client provided one, validate it's not already in use
  let assignedDeviceId: number;
  
  if (dto.deviceId && dto.deviceId > 0) {
    // Client wants specific deviceId - check if available
    const existing = existingDevices.find(d => d.deviceId === dto.deviceId);
    if (existing && existing.isActive) {
      // Device exists - this is a re-registration, update it
      assignedDeviceId = dto.deviceId;
    } else if (existing) {
      // Inactive device - reactivate
      assignedDeviceId = dto.deviceId;
    } else {
      // New device with requested ID - allow if reasonable
      assignedDeviceId = dto.deviceId;
    }
  } else {
    // Server assigns next available
    assignedDeviceId = existingDevices.length > 0 
      ? existingDevices[0].deviceId + 1 
      : 1;
  }
  
  // Continue with registration using assignedDeviceId
  // ... rest of existing logic ...
  
  return device; // Ensure assignedDeviceId is on the returned entity
}
```

### 3.2 Return Assigned deviceId in Response

**File:** `services/api/src/crypto/crypto.controller.ts`

```typescript
@Post('register')
async registerKeys(@Req() req: AuthRequest, @Body() dto: RegisterKeysDto) {
  const device = await this.cryptoService.registerDevice(req.user.sub, dto);
  
  return {
    success: true,
    deviceId: device.deviceId, // Return the assigned/confirmed deviceId
    deviceUuid: device.id,
  };
}
```

### 3.3 Validate deviceId on WebSocket Connect

**File:** `services/api/src/gateway/events.gateway.ts`

```typescript
interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  deviceId?: number; // Add deviceId to socket
}

async handleConnection(client: AuthenticatedSocket) {
  try {
    const token = client.handshake.auth?.token || 
                  client.handshake.headers?.authorization?.replace('Bearer ', '');
    const deviceId = client.handshake.auth?.deviceId; // Expect deviceId in auth

    if (!token) {
      client.emit(WSEventType.AUTH_ERROR, { message: 'No token provided' });
      client.disconnect();
      return;
    }

    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.configService.get<string>('JWT_SECRET'),
    });

    // Validate deviceId belongs to this user
    if (deviceId) {
      const device = await this.cryptoService.getDeviceByUserAndDeviceId(
        payload.sub, 
        deviceId
      );
      if (!device) {
        client.emit(WSEventType.AUTH_ERROR, { message: 'Invalid device' });
        client.disconnect();
        return;
      }
      client.deviceId = deviceId;
    }

    client.userId = payload.sub;
    client.username = payload.username;

    // Track connections by user AND device
    const userDeviceKey = `${payload.sub}:${deviceId || 'unknown'}`;
    // ... rest of connection logic ...
  }
}
```

### 3.4 Expose "My Devices" Endpoint

**File:** `services/api/src/crypto/crypto.controller.ts`

```typescript
@Get('devices')
async getMyDevices(@Req() req: AuthRequest) {
  const devices = await this.cryptoService.getUserDevices(req.user.sub);
  return {
    devices: devices.map(d => ({
      deviceId: d.deviceId,
      deviceType: d.deviceType,
      deviceName: d.deviceName,
      lastActiveAt: d.lastActiveAt,
      isActive: d.isActive,
    })),
  };
}
```

**File:** `services/api/src/crypto/crypto.service.ts`

```typescript
async getUserDevices(userId: string): Promise<DeviceEntity[]> {
  return this.deviceRepository.find({
    where: { userId, isActive: true },
    order: { lastActiveAt: 'DESC' },
  });
}

async getDeviceByUserAndDeviceId(userId: string, deviceId: number): Promise<DeviceEntity | null> {
  return this.deviceRepository.findOne({
    where: { userId, deviceId, isActive: true },
  });
}
```

---

## Part 4: Server - Message Storage & Routing

### 4.1 Per-Device Envelope Storage (Migration)

**Create migration:** `services/api/src/migrations/YYYYMMDDHHMMSS-AddPerDeviceEnvelopes.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerDeviceEnvelopes1705500000000 implements MigrationInterface {
  name = 'AddPerDeviceEnvelopes1705500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new table for per-device envelopes
    await queryRunner.query(`
      CREATE TABLE "message_envelopes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "messageId" uuid NOT NULL,
        "recipientUserId" uuid NOT NULL,
        "recipientDeviceId" integer NOT NULL,
        "ciphertext" text NOT NULL,
        "messageType" varchar(20) NOT NULL DEFAULT 'message',
        "delivered" boolean NOT NULL DEFAULT false,
        "deliveredAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_envelopes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_message_envelopes_message" FOREIGN KEY ("messageId") 
          REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    
    // Index for efficient lookup
    await queryRunner.query(`
      CREATE INDEX "IDX_message_envelopes_recipient" 
      ON "message_envelopes" ("recipientUserId", "recipientDeviceId", "delivered")
    `);
    
    // Add protocolVersion to messages if not exists
    await queryRunner.query(`
      ALTER TABLE "messages" 
      ADD COLUMN IF NOT EXISTS "protocolVersion" smallint NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "message_envelopes"`);
  }
}
```

### 4.2 Create MessageEnvelope Entity

**File:** `services/api/src/messages/message-envelope.entity.ts`

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MessageEntity } from './message.entity';

@Entity('message_envelopes')
@Index(['recipientUserId', 'recipientDeviceId', 'delivered'])
export class MessageEnvelopeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => MessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message!: MessageEntity;

  @Column({ type: 'uuid' })
  recipientUserId!: string;

  @Column({ type: 'int' })
  recipientDeviceId!: number;

  @Column({ type: 'text' })
  ciphertext!: string;

  @Column({ type: 'varchar', length: 20, default: 'message' })
  messageType!: 'prekey' | 'message';

  @Column({ type: 'boolean', default: false })
  delivered!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
```

### 4.3 Update Messages Service for Per-Device Storage

**File:** `services/api/src/messages/messages.service.ts`

```typescript
import { MessageEnvelopeEntity } from './message-envelope.entity';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(MessageEnvelopeEntity)
    private readonly envelopeRepository: Repository<MessageEnvelopeEntity>,
    // ... other deps
  ) {}

  /**
   * Create a V2 DM message with per-device envelopes.
   */
  async createV2DmMessage(
    senderId: string,
    recipientId: string,
    dto: CreateMessageDto,
    envelopes: Array<{ deviceId: number; ciphertext: string; messageType: string }>
  ): Promise<MessageEntity> {
    // Create base message
    const message = await this.create(senderId, dto);
    
    // Store per-device envelopes
    const envelopeEntities = envelopes.map(env => 
      this.envelopeRepository.create({
        messageId: message.id,
        recipientUserId: recipientId,
        recipientDeviceId: env.deviceId,
        ciphertext: env.ciphertext,
        messageType: env.messageType as 'prekey' | 'message',
      })
    );
    
    await this.envelopeRepository.save(envelopeEntities);
    
    return message;
  }

  /**
   * Get the envelope for a specific device.
   */
  async getEnvelopeForDevice(
    messageId: string,
    recipientUserId: string,
    recipientDeviceId: number
  ): Promise<MessageEnvelopeEntity | null> {
    return this.envelopeRepository.findOne({
      where: { messageId, recipientUserId, recipientDeviceId },
    });
  }

  /**
   * Mark envelope as delivered.
   */
  async markEnvelopeDelivered(envelopeId: string): Promise<void> {
    await this.envelopeRepository.update(envelopeId, {
      delivered: true,
      deliveredAt: new Date(),
    });
  }
}
```

### 4.4 Route DM Messages by Device

**File:** `services/api/src/gateway/events.gateway.ts`

```typescript
@SubscribeMessage(WSEventType.MESSAGE_SEND)
async handleMessage(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() data: EncryptedMessagePayload,
) {
  if (!client.userId) {
    return { error: 'Not authenticated' };
  }

  try {
    // ... authorization checks ...

    if (data.recipientId) {
      // DM message - handle V2 per-device routing
      const parsedEnvelope = JSON.parse(data.encryptedEnvelope);
      const isV2 = parsedEnvelope.protocolVersion === 2 && 
                   Array.isArray(parsedEnvelope.envelopes);

      if (isV2) {
        // V2: Store per-device envelopes and route to each device
        const message = await this.messagesService.createV2DmMessage(
          client.userId,
          data.recipientId,
          {
            recipientId: data.recipientId,
            encryptedEnvelope: data.encryptedEnvelope,
            clientNonce: data.clientNonce,
            protocolVersion: 2,
          },
          parsedEnvelope.envelopes
        );

        // Route to each recipient device
        for (const env of parsedEnvelope.envelopes) {
          const devicePayload = {
            ...this.buildMessagePayload(message, client),
            encryptedEnvelope: JSON.stringify({
              type: 'dm',
              senderDeviceId: parsedEnvelope.senderDeviceId,
              ciphertext: env.ciphertext,
              messageType: env.messageType,
              protocolVersion: 1, // Send as V1 to individual devices
            }),
          };

          // Send to specific device socket
          this.sendToUserDevice(
            data.recipientId,
            env.recipientDeviceId,
            WSEventType.MESSAGE_RECEIVED,
            devicePayload
          );
        }

        // Also send to sender's other devices (for sync)
        if (parsedEnvelope.senderEnvelopes) {
          for (const env of parsedEnvelope.senderEnvelopes) {
            if (env.recipientDeviceId !== client.deviceId) {
              this.sendToUserDevice(
                client.userId,
                env.recipientDeviceId,
                WSEventType.MESSAGE_RECEIVED,
                { /* sender device payload */ }
              );
            }
          }
        }

        return { success: true, messageId: message.id };
      } else {
        // V1: Legacy single envelope - broadcast to DM room
        // ... existing logic ...
      }
    }
    // ... channel message handling ...
  } catch (error) {
    // ... error handling ...
  }
}

/**
 * Send to a specific user's device.
 */
private sendToUserDevice(
  userId: string,
  deviceId: number,
  event: WSEventType,
  payload: unknown
): void {
  const userSockets = this.connectedUsers.get(userId);
  if (!userSockets) return;

  for (const socketId of userSockets) {
    const socket = this.server.sockets.sockets.get(socketId) as AuthenticatedSocket;
    if (socket && socket.deviceId === deviceId) {
      socket.emit(event, payload);
      return;
    }
  }
  
  // Device not connected - message will be fetched on reconnect
}
```

---

## Part 5: Desktop - Device Registration & Multi-Device Encryption

### 5.1 Persist Server-Assigned deviceId

**File:** `apps/desktop/src/crypto/SignalWrapper.ts`

```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;

  // ... store initialization ...

  // Load persisted device ID (server-assigned)
  const storedDeviceId = await this.keyStore.get('device_id');
  if (storedDeviceId) {
    this.deviceId = parseInt(new TextDecoder().decode(storedDeviceId), 10);
  }
  // Don't default to 1 - let server assign on first registration

  this.initialized = true;
}

/**
 * Set the device ID after server registration.
 */
async setDeviceId(deviceId: number): Promise<void> {
  this.deviceId = deviceId;
  await this.keyStore.set('device_id', new TextEncoder().encode(deviceId.toString()));
}
```

**File:** `apps/desktop/src/lib/messagingService.ts`

```typescript
private async registerDeviceKeys(): Promise<void> {
  const crypto = getCrypto();
  const api = getApiClient();

  try {
    const bundle = await crypto.getPreKeyBundle();

    // Register with server - may not have deviceId yet
    const result = await api.registerDeviceKeys({
      deviceId: crypto.getDeviceId() || 0, // 0 = server assigns
      deviceType: DeviceType.DESKTOP,
      deviceName: 'Desktop App',
      identityKey: bundle.identityKey,
      registrationId: bundle.registrationId,
      signedPreKey: bundle.signedPreKey,
      preKeys: bundle.preKeys,
    });

    // Store server-assigned deviceId
    this._deviceId = result.deviceId;
    await crypto.setDeviceId(result.deviceId);
    
    console.log('[MessagingService] Device registered with ID:', result.deviceId);
  } catch (error) {
    console.error('[MessagingService] Failed to register device keys:', error);
    throw error;
  }
}
```

### 5.2 Send deviceId with WebSocket Auth

**File:** `apps/desktop/src/lib/socket.ts`

```typescript
connect(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // ... existing checks ...

    const messagingService = getMessagingService();
    const deviceId = messagingService.getDeviceId();

    this.socket = io(WS_URL, {
      auth: { 
        token,
        deviceId, // Include deviceId in auth
      },
      transports: ['websocket'],
      // ... other options ...
    });

    // ... rest of connection logic ...
  });
}
```

### 5.3 Multi-Device DM Encryption

**File:** `apps/desktop/src/lib/messagingService.ts`

```typescript
/**
 * Encrypt a DM for all recipient devices.
 */
private async encryptDmMessage(
  recipientId: string,
  plaintext: string
): Promise<EncryptedEnvelope> {
  const crypto = getCrypto();
  const api = getApiClient();

  // Fetch ALL device bundles for recipient
  const { bundles } = await api.getPreKeyBundle(recipientId);
  if (!bundles.length) {
    throw new Error(`No devices found for user ${recipientId}`);
  }

  const envelopes: DeviceEnvelope[] = [];

  // Encrypt for each recipient device
  for (const bundle of bundles) {
    // Ensure session exists
    if (!(await crypto.hasDmSession(recipientId, bundle.deviceId))) {
      await crypto.ensureDmSession(recipientId, this.convertBundle(bundle), bundle.deviceId);
    }

    // Encrypt for this device
    const encrypted = await crypto.encryptDmForDevice(recipientId, bundle.deviceId, plaintext);
    
    envelopes.push({
      recipientDeviceId: bundle.deviceId,
      ciphertext: encrypted.ciphertext,
      messageType: encrypted.type,
    });
  }

  // Optionally encrypt for sender's OTHER devices (for sync)
  const myDevices = await api.getMyDevices();
  const myDeviceId = this.getDeviceId();
  const senderEnvelopes: DeviceEnvelope[] = [];
  
  for (const device of myDevices.devices) {
    if (device.deviceId !== myDeviceId) {
      // Encrypt for our other device
      // Note: This requires self-session setup
      const encrypted = await crypto.encryptDmForDevice(
        this.localUserId!, 
        device.deviceId, 
        plaintext
      );
      senderEnvelopes.push({
        recipientDeviceId: device.deviceId,
        ciphertext: encrypted.ciphertext,
        messageType: encrypted.type,
      });
    }
  }

  return {
    type: 'dm',
    senderDeviceId: myDeviceId!,
    protocolVersion: 2,
    envelopes,
    senderEnvelopes: senderEnvelopes.length > 0 ? senderEnvelopes : undefined,
  } as any; // V2 format
}
```

### 5.4 Update Crypto APIs for Per-Device Encryption

**File:** `apps/desktop/src/crypto/types.ts`

```typescript
export interface RailGunCrypto {
  // ... existing methods ...

  /** Check if session exists with specific device */
  hasDmSession(peerUserId: string, deviceId?: number): Promise<boolean>;

  /** Ensure session with specific device */
  ensureDmSession(
    peerUserId: string,
    peerPreKeyBundle?: PreKeyBundleFromServer,
    deviceId?: number
  ): Promise<void>;

  /** Encrypt DM for specific device */
  encryptDmForDevice(
    peerUserId: string,
    deviceId: number,
    plaintext: string
  ): Promise<EncryptedMessage>;

  /** Set device ID (server-assigned) */
  setDeviceId(deviceId: number): Promise<void>;
}
```

**File:** `apps/desktop/src/crypto/RailGunCrypto.ts`

```typescript
/**
 * Check if we have a DM session with a specific device.
 */
async hasDmSession(peerUserId: string, deviceId: number = 1): Promise<boolean> {
  this.ensureInitialized();
  return this.signal.hasSession(peerUserId, deviceId);
}

/**
 * Ensure DM session with specific device.
 */
async ensureDmSession(
  peerUserId: string,
  peerPreKeyBundle?: PreKeyBundleFromServer,
  deviceId?: number
): Promise<void> {
  this.ensureInitialized();

  const targetDeviceId = deviceId ?? peerPreKeyBundle?.deviceId ?? 1;

  if (await this.signal.hasSession(peerUserId, targetDeviceId)) {
    return;
  }

  if (!peerPreKeyBundle) {
    throw new Error(
      `No session with ${peerUserId}:${targetDeviceId} and no prekey bundle provided`
    );
  }

  await this.signal.createSession(peerUserId, targetDeviceId, {
    identityKey: this.fromBase64(peerPreKeyBundle.identityKey),
    registrationId: peerPreKeyBundle.registrationId,
    signedPreKey: {
      id: peerPreKeyBundle.signedPreKey.keyId,
      publicKey: this.fromBase64(peerPreKeyBundle.signedPreKey.publicKey),
      signature: this.fromBase64(peerPreKeyBundle.signedPreKey.signature),
    },
    kyberPreKey: { id: 1, publicKey: new Uint8Array(32), signature: new Uint8Array(64) },
    preKey: peerPreKeyBundle.preKey
      ? {
          id: peerPreKeyBundle.preKey.keyId,
          publicKey: this.fromBase64(peerPreKeyBundle.preKey.publicKey),
        }
      : undefined,
  });
}

/**
 * Encrypt DM for a specific device.
 */
async encryptDmForDevice(
  peerUserId: string,
  deviceId: number,
  plaintext: string
): Promise<EncryptedMessage> {
  this.ensureInitialized();

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const result = await this.signal.encrypt(peerUserId, deviceId, plaintextBytes);

  return {
    type: result.type === 3 ? 'prekey' : 'message',
    ciphertext: this.toBase64(result.body),
    senderDeviceId: this.signal.getDeviceId(),
    registrationId: result.type === 3 ? await this.signal.getRegistrationId() : undefined,
  };
}

/**
 * Set device ID (called after server registration).
 */
async setDeviceId(deviceId: number): Promise<void> {
  this.ensureInitialized();
  await this.signal.setDeviceId(deviceId);
}
```

---

## Part 6: Channel Sender-Key Distribution (Per-Device)

### 6.1 Return All Member Device IDs

**File:** `services/api/src/communities/channel-crypto.service.ts`

```typescript
/**
 * Get all members with ALL their devices for sender key distribution.
 */
async getChannelMembersWithDevices(
  channelId: string,
  requestingUserId: string,
): Promise<Array<{ userId: string; username: string; devices: number[] }>> {
  // ... existing member lookup ...

  const result = [];
  for (const member of members) {
    // Get all active devices for this member
    const devices = await this.deviceRepository.find({
      where: { userId: member.userId, isActive: true },
      select: ['deviceId'],
    });
    
    result.push({
      userId: member.userId,
      username: member.user.username,
      devices: devices.map(d => d.deviceId),
    });
  }

  return result;
}
```

### 6.2 Extend Sender-Key Distribution Entity

**File:** `services/api/src/communities/sender-key-distribution.entity.ts`

```typescript
// Add recipientDeviceId column
@Column({ type: 'int', default: 1 })
recipientDeviceId!: number;
```

### 6.3 Update Client Sender-Key Distribution

**File:** `apps/desktop/src/lib/messagingService.ts`

```typescript
/**
 * Distribute sender key to ALL member devices.
 */
private async distributeSenderKey(channelId: string, memberUserIds: string[]): Promise<void> {
  const crypto = getCrypto();
  const api = getApiClient();

  const distribution = await crypto.getSenderKeyDistribution(channelId);
  if (!distribution) return;

  const distributionBase64 = typeof distribution === 'string' 
    ? distribution 
    : btoa(String.fromCharCode(...distribution));

  // Get all member devices
  const membersWithDevices = await api.getChannelMembersWithDevices(channelId);

  for (const member of membersWithDevices) {
    if (member.userId === this.localUserId) continue;

    for (const deviceId of member.devices) {
      try {
        await api.sendSenderKeyDistribution(channelId, member.userId, deviceId, distributionBase64);
      } catch (err) {
        console.warn(`[MessagingService] Failed to send sender key to ${member.userId}:${deviceId}:`, err);
      }
    }
  }
}
```

---

## Part 7: Real-time Delivery Semantics

### 7.1 Deliver DMs Without Room Membership

**File:** `services/api/src/gateway/events.gateway.ts`

The `sendToUserDevice()` method added in Part 4.4 already handles this. For fallback:

```typescript
/**
 * Send to all of a user's connected devices.
 */
private sendToUser(userId: string, event: WSEventType, payload: unknown): void {
  const userSockets = this.connectedUsers.get(userId);
  if (!userSockets) return;

  for (const socketId of userSockets) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, payload);
    }
  }
}
```

### 7.2 Optional: Auto-Join DM Rooms on Login

**File:** `apps/desktop/src/components/Sidebar.tsx`

```typescript
// After fetching DM conversations, auto-join all rooms
useEffect(() => {
  if (!accessToken || !isTokensLoaded) return;
  
  const fetchAndJoinDms = async () => {
    try {
      const api = getApiClient();
      const { conversations } = await api.getDmConversations();
      
      setDmConversations(/* ... */);

      // Auto-join all DM rooms for real-time delivery
      for (const conv of conversations) {
        if (socketClient.isConnected()) {
          socketClient.joinDm(conv.conversationId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch DM conversations:', err);
    }
  };
  
  fetchAndJoinDms();
}, [accessToken, isTokensLoaded]);
```

---

## Part 8: AWS Removal (Fly.io Migration)

### 8.1 Update Deployment Documentation

**File:** `docs/DEPLOYMENT.md`

Replace AWS sections with Fly.io as primary:

```markdown
## Backend Deployment

### Recommended: Fly.io

Fly.io provides a simple, cost-effective deployment with WebSocket support.

#### Prerequisites
- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account

#### Deploy Steps

1. **Initialize** (first time only):
   ```bash
   cd /path/to/railgun
   fly launch --no-deploy
   ```

2. **Create PostgreSQL**:
   ```bash
   fly postgres create --name railgun-db
   fly postgres attach railgun-db
   ```

3. **Create Redis** (via Upstash):
   ```bash
   fly redis create
   ```

4. **Set Secrets**:
   ```bash
   fly secrets set JWT_SECRET="$(openssl rand -base64 64)"
   fly secrets set RECOVERY_CODE_SECRET="$(openssl rand -base64 32)"
   fly secrets set DM_ID_SECRET="$(openssl rand -base64 32)"
   fly secrets set STRIPE_SECRET_KEY="sk_..."
   fly secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
   ```

5. **Deploy**:
   ```bash
   fly deploy
   ```

#### Scaling
```bash
# Scale to 2 machines in different regions
fly scale count 2 --region ord,iad
```

### Database Options (Non-AWS)
- **Supabase**: Free tier, managed Postgres
- **Neon**: Serverless Postgres
- **PlanetScale**: MySQL-compatible (if migrating)
- **Railway**: Simple managed Postgres

### Redis Options (Non-AWS)
- **Upstash**: Serverless Redis, Fly integration
- **Redis Cloud**: Managed Redis
- **Railway Redis**: Simple option
```

### 8.2 Archive/Remove Terraform and AWS Deploy Script

**Action:** Move AWS infra to an archive folder:

```bash
# In workspace root
mkdir -p infra-archive/aws
mv infra/terraform infra-archive/aws/
mv infra/deploy.sh infra-archive/aws/

# Create README in archive
cat > infra-archive/aws/README.md << 'EOF'
# Archived AWS Infrastructure

This directory contains the original AWS Terraform configuration.
As of January 2026, Railgun has migrated to Fly.io.

**DO NOT USE** - Retained for reference only.

If you need AWS deployment, review and update these files carefully.
Secrets in `terraform.tfvars` should be rotated before any use.
EOF
```

### 8.3 Update fly.toml

**File:** `fly.toml` (in repo root)

Already configured correctly. Verify it points to correct build context.

### 8.4 Refactor Hybrid Transport Types

**File:** `packages/shared/src/types/hybrid-transport.types.ts`

Rename AWS-specific terminology to be provider-agnostic:

```typescript
// Change:
export type TransportMode = 'aws' | 'hybrid' | 'p2p-only';

// To:
export type TransportMode = 'cloud' | 'hybrid' | 'p2p-only';

// Change:
export type TransportState =
  | 'connected-aws'
  // ...

// To:
export type TransportState =
  | 'connected-cloud'
  | 'connected-hybrid'
  | 'connected-p2p'
  | 'degraded'
  | 'connecting'
  | 'disconnected';

// Change:
export type TransportSwitchReason =
  | 'aws-unreachable'
  | 'aws-blocked'
  // ...

// To:
export type TransportSwitchReason =
  | 'cloud-unreachable'
  | 'cloud-blocked'
  | 'latency-threshold'
  | 'manual'
  | 'policy'
  | 'cloud-restored'
  | 'load-balance';

// Update all interfaces referencing AWS → cloud
export interface AWSHealthChangedEvent extends HybridTransportEvent {
// To:
export interface CloudHealthChangedEvent extends HybridTransportEvent {
```

### 8.5 Update Auto-Updater

**File:** `apps/desktop/electron/auto-updater.ts`

The auto-updater is already generic (uses `updateServerUrl` config). Ensure no S3-specific code:

```typescript
// Verify UpdateConfig doesn't reference S3
export interface UpdateConfig {
  /** Base URL for update manifest and artifacts */
  updateServerUrl: string; // Can be any HTTPS URL
  // ...
}
```

For hosting updates, use:
- **GitHub Releases** (current, recommended)
- **Cloudflare R2** (S3-compatible, no egress fees)
- **Backblaze B2** (cheap storage)

### 8.6 Update External Dependencies Doc

**File:** `docs/EXTERNAL_DEPENDENCIES.md`

Update to reflect non-AWS options:

```markdown
## Infrastructure Dependencies

### Hosting
- **API**: Fly.io (primary), Railway, Render
- **Database**: Supabase Postgres, Neon, Fly Postgres
- **Cache**: Upstash Redis, Redis Cloud

### Update Artifacts
- **Primary**: GitHub Releases
- **CDN**: Cloudflare R2 or Backblaze B2

### NOT USED
- ~~AWS EC2, ECS, RDS, ElastiCache, S3~~
```

---

## Part 9: Tests & Verification

### 9.1 Multi-Device DM Tests

**File:** `apps/desktop/src/crypto/__tests__/crypto.e2e.test.ts`

Add test cases:

```typescript
describe('Multi-Device DM', () => {
  it('should encrypt for multiple recipient devices', async () => {
    // Setup: Alice with 2 devices, Bob with 1 device
    const aliceDevice1 = await createTestDevice('alice', 1);
    const aliceDevice2 = await createTestDevice('alice', 2);
    const bobDevice1 = await createTestDevice('bob', 1);

    // Bob encrypts message for Alice
    const plaintext = 'Hello Alice!';
    const bundles = [aliceDevice1.bundle, aliceDevice2.bundle];
    
    const envelope = await bobDevice1.crypto.encryptDmMultiDevice('alice', bundles, plaintext);

    expect(envelope.envelopes).toHaveLength(2);
    expect(envelope.envelopes[0].recipientDeviceId).toBe(1);
    expect(envelope.envelopes[1].recipientDeviceId).toBe(2);

    // Both Alice devices can decrypt
    const decrypted1 = await aliceDevice1.crypto.decryptDm('bob', {
      ...envelope,
      ciphertext: envelope.envelopes[0].ciphertext,
    });
    const decrypted2 = await aliceDevice2.crypto.decryptDm('bob', {
      ...envelope,
      ciphertext: envelope.envelopes[1].ciphertext,
    });

    expect(decrypted1).toBe(plaintext);
    expect(decrypted2).toBe(plaintext);
  });

  it('should handle V1 and V2 message formats', async () => {
    // Test backward compatibility
  });
});
```

### 9.2 WebSocket Routing Tests

**Create:** `services/api/src/gateway/__tests__/events.gateway.spec.ts`

```typescript
describe('EventsGateway', () => {
  describe('DM Routing', () => {
    it('should route V2 DM to specific device', async () => {
      // Mock two connected sockets for same user, different devices
      const socket1 = createMockSocket('user1', 1);
      const socket2 = createMockSocket('user1', 2);

      // Send V2 message targeting device 2
      const v2Message = {
        type: 'dm',
        senderDeviceId: 1,
        protocolVersion: 2,
        envelopes: [
          { recipientDeviceId: 2, ciphertext: 'encrypted', messageType: 'message' }
        ],
      };

      await gateway.handleMessage(senderSocket, {
        recipientId: 'user1',
        encryptedEnvelope: JSON.stringify(v2Message),
        clientNonce: 'nonce',
      });

      // Only socket2 should receive message
      expect(socket1.emit).not.toHaveBeenCalledWith(WSEventType.MESSAGE_RECEIVED);
      expect(socket2.emit).toHaveBeenCalledWith(WSEventType.MESSAGE_RECEIVED, expect.anything());
    });
  });
});
```

### 9.3 Smoke Test Checklist

```markdown
## Multi-Device Smoke Test

### Setup
1. Create two user accounts (Alice, Bob)
2. Login Alice on Desktop (device 1)
3. Login Alice on second Desktop/web (device 2) - simulated or real
4. Login Bob on Desktop

### Tests

#### DM: Bob → Alice
- [ ] Bob sends DM to Alice
- [ ] Alice device 1 receives and decrypts
- [ ] Alice device 2 receives and decrypts
- [ ] Both devices show same plaintext

#### DM: Alice → Bob (from device 2)
- [ ] Alice device 2 sends DM to Bob
- [ ] Bob receives and decrypts
- [ ] Alice device 1 sees the sent message (sync)

#### Channel Message
- [ ] Bob sends channel message
- [ ] Alice device 1 receives via sender key
- [ ] Alice device 2 receives via sender key

#### Device Registration
- [ ] New device gets server-assigned deviceId
- [ ] deviceId persists across app restart
- [ ] WebSocket auth includes deviceId
```

### 9.4 Update Protocol Documentation

**Create:** `docs/PROTOCOL_SPECIFICATION_V2.md`

```markdown
# Rail Gun Protocol Specification v2

## Overview
Version 2 introduces per-device message envelopes for true multi-device support.

## Changes from V1
- `protocolVersion` field added to all message payloads
- DM messages contain `envelopes[]` array instead of single `ciphertext`
- Each envelope targets a specific `recipientDeviceId`
- Server routes messages to specific device sockets
- Sender's other devices receive copies for sync (optional)

## Message Formats

### V2 DM Message
```json
{
  "type": "dm",
  "senderDeviceId": 1,
  "registrationId": 12345,
  "protocolVersion": 2,
  "envelopes": [
    {
      "recipientDeviceId": 1,
      "ciphertext": "base64...",
      "messageType": "prekey"
    },
    {
      "recipientDeviceId": 2,
      "ciphertext": "base64...",
      "messageType": "message"
    }
  ],
  "senderEnvelopes": [
    {
      "recipientDeviceId": 2,
      "ciphertext": "base64...",
      "messageType": "message"
    }
  ]
}
```

### Backward Compatibility
V1 messages are still accepted. Detection is via:
- Missing `protocolVersion` or `protocolVersion === 1`
- Presence of `ciphertext` field instead of `envelopes`

## Device Identity
- Device IDs are server-assigned on registration
- Device ID 0 in registration request = server assigns next available
- Device IDs are sequential per-user (1, 2, 3, ...)
```

---

## Implementation Status (Updated January 17, 2026)

### Multi-Device Messaging ✅ COMPLETED

| Task | Status | Files Modified |
|------|--------|----------------|
| Protocol version bump to 2 | ✅ | `packages/shared/src/enums.ts` |
| Shared V2 messaging types | ✅ | `packages/shared/src/types/messaging.types.ts` (NEW) |
| Message envelopes migration | ✅ | `services/api/src/migrations/1705500000000-AddPerDeviceEnvelopes.ts` (NEW) |
| MessageEnvelopeEntity | ✅ | `services/api/src/messages/message-envelope.entity.ts` (NEW) |
| Server-assigned deviceIds | ✅ | `services/api/src/crypto/crypto.service.ts` |
| GET /keys/devices/:userId | ✅ | `services/api/src/crypto/crypto.controller.ts` |
| MessagesService V2 methods | ✅ | `services/api/src/messages/messages.service.ts` |
| EventsGateway device routing | ✅ | `services/api/src/gateway/events.gateway.ts` |
| WebSocket deviceId auth | ✅ | `apps/desktop/src/lib/socket.ts` |
| Desktop crypto (types) | ✅ | `apps/desktop/src/crypto/types.ts` |
| Desktop crypto (RailGunCrypto) | ✅ | `apps/desktop/src/crypto/RailGunCrypto.ts` |
| Desktop crypto (SimpleCrypto) | ✅ | `apps/desktop/src/crypto/SimpleCrypto.ts` |
| Desktop crypto (ElectronCryptoImpl) | ✅ | `apps/desktop/src/crypto/index.ts` |
| Desktop messagingService V2 | ✅ | `apps/desktop/src/lib/messagingService.ts` |
| Desktop api.ts getUserDevices | ✅ | `apps/desktop/src/lib/api.ts` |
| Channel sender-key entity | ✅ | `services/api/src/communities/sender-key-distribution.entity.ts` |
| Channel sender-key migration | ✅ | `services/api/src/migrations/1705600000000-AddRecipientDeviceIdToSenderKey.ts` (NEW) |
| Channel sender-key service | ✅ | `services/api/src/communities/channel-crypto.service.ts` |
| Channel sender-key controller | ✅ | `services/api/src/communities/channels.controller.ts` |
| iOS server-assigned deviceId | ✅ | `RailGun/Core/Crypto/CryptoManager.swift` |
| iOS multi-device encryption | ✅ | `RailGun/Core/Crypto/CryptoManager.swift` |
| iOS ChatManager V2 sending | ✅ | `RailGun/Core/Chat/ChatManager.swift` |
| iOS APIClient V2 methods | ✅ | `RailGun/Core/Network/APIClient.swift` |
| iOS Models (UserDevicesResponse) | ✅ | `RailGun/Core/Models/Models.swift` |
| Android server-assigned deviceId | ✅ | `app/src/main/java/com/railgun/android/data/repository/DMRepository.kt` |
| Android multi-device encryption | ✅ | `app/src/main/java/com/railgun/android/crypto/CryptoManager.kt` |
| Android V2 API methods | ✅ | `app/src/main/java/com/railgun/android/data/api/RailgunApi.kt` |
| Android V2 models | ✅ | `app/src/main/java/com/railgun/android/data/model/CryptoModels.kt` |
| Android DMRepository V2 sending | ✅ | `app/src/main/java/com/railgun/android/data/repository/DMRepository.kt` |

### AWS Removal ✅ COMPLETED

| Task | Status | Files Modified |
|------|--------|----------------|
| Archive Terraform | ✅ | `infra/terraform-aws-archive/` (created) |
| Create Fly.io deploy.sh | ✅ | `infra/deploy.sh` (NEW) |
| Rename AWS deploy script | ✅ | `infra/deploy-aws.sh` |
| Update DEPLOYMENT.md | ✅ | `docs/DEPLOYMENT.md` |
| Update infra README | ✅ | `infra/README.md` |
| Update env example | ✅ | `.env.production.example` |

### Remaining Tasks ✅ COMPLETED

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| E2E tests for multi-device | Medium | ✅ | `services/api/src/messages/messages.e2e.spec.ts` |
| Migration testing script | High | ✅ | `scripts/test-migrations.sh` |
| Testing documentation | High | ✅ | `docs/TESTING_GUIDE.md` |
| Verification script | High | ✅ | `scripts/verify-implementation.sh` |
| Implementation verification | High | ✅ | All checks passed |

### Ready for Deployment

The implementation is complete and ready for testing:

1. **Run Verification**: `./scripts/verify-implementation.sh`
2. **Test Migrations**: `./scripts/test-migrations.sh --confirm` (on test DB)
3. **Run E2E Tests**: `cd services/api && pnpm test:e2e messages.e2e.spec.ts`
4. **Manual Testing**: Follow `docs/TESTING_GUIDE.md`
5. **Deploy to Staging**: Use `infra/deploy.sh` for Fly.io deployment

---

*Document updated: January 17, 2026*
