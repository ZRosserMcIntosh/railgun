import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { DmConversationEntity } from './dm-conversation.entity';
import { UsersService } from '../users/users.service';

/** DTO for DM conversation with peer info */
export interface DmConversationDto {
  conversationId: string;
  peerId: string;
  peerUsername: string;
  peerDisplayName: string;
  peerAvatarUrl?: string;
  peerPresence: string;
  lastMessageAt?: Date;
  createdAt: string;
}

/**
 * SECURITY: Conversation ID derivation key.
 * This prevents enumeration attacks where an attacker could probe for
 * conversations between arbitrary user pairs by guessing sorted ID combinations.
 * 
 * The key is loaded from environment (DM_ID_SECRET) in production.
 * A fallback is used in development only.
 * 
 * KEY ROTATION: To rotate secrets without breaking lookups, set DM_ID_SECRET_V2
 * (and V3, etc.) and the service will try all versions during lookups.
 */
const DM_ID_SECRET_FALLBACK = 'railgun-dm-id-derivation-key-change-in-production';

@Injectable()
export class DmService {
  /** Primary (latest) secret for generating new conversation IDs */
  private readonly dmIdSecret: string;
  
  /** All secret versions for lookup (latest first) */
  private readonly dmIdSecretVersions: string[];
  
  constructor(
    @InjectRepository(DmConversationEntity)
    private readonly dmRepository: Repository<DmConversationEntity>,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    // Load secrets from environment
    // Support versioned secrets: DM_ID_SECRET (current), DM_ID_SECRET_V1, DM_ID_SECRET_V2, etc.
    const currentSecret = this.configService.get<string>('DM_ID_SECRET') || DM_ID_SECRET_FALLBACK;
    this.dmIdSecret = currentSecret;
    
    // Build list of all secret versions for lookup (newest first)
    this.dmIdSecretVersions = [currentSecret];
    
    // Check for older secret versions (for dual-lookup during rotation)
    for (let v = 1; v <= 10; v++) {
      const versionedSecret = this.configService.get<string>(`DM_ID_SECRET_V${v}`);
      if (versionedSecret && versionedSecret !== currentSecret) {
        this.dmIdSecretVersions.push(versionedSecret);
      }
    }
    
    // Warn if using fallback in non-development
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (!this.configService.get<string>('DM_ID_SECRET') && nodeEnv === 'production') {
      console.error('[SECURITY WARNING] DM_ID_SECRET not set in production! DM IDs may be predictable.');
    }
    
    if (this.dmIdSecretVersions.length > 1) {
      console.log(`[DmService] Loaded ${this.dmIdSecretVersions.length} secret versions for dual-lookup`);
    }
  }

  /**
   * Generate deterministic, non-enumerable conversation ID from two user IDs.
   * 
   * SECURITY: Uses HMAC-SHA256 with a server secret to prevent enumeration attacks.
   * An attacker cannot probe for conversations between arbitrary users without
   * knowing the server secret.
   * 
   * @param userId1 - First user's ID
   * @param userId2 - Second user's ID
   * @returns HMAC-derived conversation ID (32 hex chars)
   */
  generateConversationId(userId1: string, userId2: string): string {
    // Sort IDs to ensure consistency regardless of order
    const sorted = [userId1, userId2].sort();
    const payload = `${sorted[0]}:${sorted[1]}`;
    
    // SECURITY: Use HMAC-SHA256 to derive a non-enumerable conversation ID
    // This prevents attackers from probing for conversations between arbitrary users
    const hmac = createHmac('sha256', this.dmIdSecret);
    hmac.update(payload);
    
    // Return first 32 hex characters (128 bits) - sufficient for uniqueness
    return hmac.digest('hex').substring(0, 32);
  }

  /**
   * Generate all possible conversation IDs for a user pair (all secret versions).
   * Used for lookup during secret rotation periods.
   */
  private generateAllConversationIds(userId1: string, userId2: string): string[] {
    const sorted = [userId1, userId2].sort();
    const payload = `${sorted[0]}:${sorted[1]}`;
    
    return this.dmIdSecretVersions.map(secret => {
      const hmac = createHmac('sha256', secret);
      hmac.update(payload);
      return hmac.digest('hex').substring(0, 32);
    });
  }

  /**
   * Generate a non-enumerable self-DM conversation ID.
   * 
   * SECURITY: Uses HMAC-SHA256 with a server secret to prevent enumeration.
   * 
   * @param userId - The user's ID
   * @returns HMAC-derived self-DM conversation ID (32 hex chars)
   */
  generateSelfDmId(userId: string): string {
    const payload = `self:${userId}`;
    const hmac = createHmac('sha256', this.dmIdSecret);
    hmac.update(payload);
    return hmac.digest('hex').substring(0, 32);
  }

  /**
   * Generate all possible self-DM IDs (all secret versions).
   * Used for lookup during secret rotation periods.
   */
  private generateAllSelfDmIds(userId: string): string[] {
    const payload = `self:${userId}`;
    
    return this.dmIdSecretVersions.map(secret => {
      const hmac = createHmac('sha256', secret);
      hmac.update(payload);
      return hmac.digest('hex').substring(0, 32);
    });
  }

  /**
   * Find existing conversation using dual-lookup (supports secret rotation).
   * Returns null if not found with any secret version.
   */
  private async findExistingConversation(
    userId1: string,
    userId2: string,
    isSelfDm: boolean
  ): Promise<DmConversationEntity | null> {
    // Generate all possible IDs (from all secret versions)
    const possibleIds = isSelfDm 
      ? this.generateAllSelfDmIds(userId1)
      : this.generateAllConversationIds(userId1, userId2);
    
    // Try each possible ID
    for (const conversationId of possibleIds) {
      const conversation = await this.dmRepository.findOne({
        where: { conversationId },
      });
      if (conversation) {
        return conversation;
      }
    }
    
    return null;
  }

  /**
   * Start a DM conversation with another user.
   * Returns existing conversation if one already exists.
   * Supports self-DMs (Saved Messages / Notes to Self)
   */
  async startDm(
    currentUserId: string,
    targetUsername: string,
  ): Promise<{ conversationId: string; peerId: string; isNew: boolean }> {
    // Find target user
    const targetUser = await this.usersService.findByUsername(targetUsername);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Allow self-DMs (Saved Messages / Notes to Self)
    const isSelfDm = targetUser.id === currentUserId;
    
    const sortedIds = [currentUserId, targetUser.id].sort();

    // Check if conversation already exists (dual-lookup for secret rotation)
    const existingConversation = await this.findExistingConversation(
      currentUserId,
      targetUser.id,
      isSelfDm
    );

    if (existingConversation) {
      return {
        conversationId: existingConversation.conversationId,
        peerId: targetUser.id,
        isNew: false,
      };
    }

    // Generate new conversation ID with current (latest) secret
    const conversationId = isSelfDm
      ? this.generateSelfDmId(currentUserId)
      : this.generateConversationId(currentUserId, targetUser.id);

    // Create new conversation
    const conversation = this.dmRepository.create({
      conversationId,
      user1Id: sortedIds[0],
      user2Id: sortedIds[1],
    });

    await this.dmRepository.save(conversation);

    return {
      conversationId: conversation.conversationId,
      peerId: targetUser.id,
      isNew: true,
    };
  }

  /**
   * Start a DM conversation by user ID.
   * Supports self-DMs (Saved Messages / Notes to Self)
   */
  async startDmByUserId(
    currentUserId: string,
    targetUserId: string,
  ): Promise<{ conversationId: string; peerId: string; isNew: boolean }> {
    // Find target user
    const targetUser = await this.usersService.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Allow self-DMs (Saved Messages / Notes to Self)
    // This is useful for storing personal notes, reminders, or testing
    const isSelfDm = targetUser.id === currentUserId;
    
    const sortedIds = [currentUserId, targetUser.id].sort();

    // Check if conversation already exists (dual-lookup for secret rotation)
    const existingConversation = await this.findExistingConversation(
      currentUserId,
      targetUser.id,
      isSelfDm
    );

    if (existingConversation) {
      return {
        conversationId: existingConversation.conversationId,
        peerId: targetUser.id,
        isNew: false,
      };
    }

    // Generate new conversation ID with current (latest) secret
    const conversationId = isSelfDm 
      ? this.generateSelfDmId(currentUserId)
      : this.generateConversationId(currentUserId, targetUser.id);

    // Create new conversation
    const conversation = this.dmRepository.create({
      conversationId,
      user1Id: sortedIds[0],
      user2Id: sortedIds[1],
    });

    await this.dmRepository.save(conversation);

    return {
      conversationId: conversation.conversationId,
      peerId: targetUser.id,
      isNew: true,
    };
  }

  /**
   * Get all DM conversations for a user.
   */
  async getUserDms(userId: string): Promise<DmConversationDto[]> {
    const conversations = await this.dmRepository.find({
      where: [{ user1Id: userId }, { user2Id: userId }],
      order: { lastMessageAt: 'DESC' },
    });

    const results: DmConversationDto[] = [];

    for (const conv of conversations) {
      // Determine peer ID
      const peerId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;

      // Get peer user info
      const peer = await this.usersService.findById(peerId);
      if (!peer) continue; // Skip if peer no longer exists

      results.push({
        conversationId: conv.conversationId,
        peerId: peer.id,
        peerUsername: peer.username,
        peerDisplayName: peer.displayName,
        peerAvatarUrl: peer.avatarUrl,
        peerPresence: peer.presence,
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt,
      });
    }

    return results;
  }

  /**
   * Get a specific DM conversation.
   */
  async getDm(conversationId: string): Promise<DmConversationEntity | null> {
    return this.dmRepository.findOne({
      where: { conversationId },
    });
  }

  /**
   * Check if a user is a participant in a DM conversation.
   */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.dmRepository.findOne({
      where: { conversationId },
    });

    if (!conversation) {
      return false;
    }

    return conversation.user1Id === userId || conversation.user2Id === userId;
  }

  /**
   * Update last message timestamp for a conversation.
   */
  async updateLastMessage(conversationId: string): Promise<void> {
    await this.dmRepository.update(
      { conversationId },
      { lastMessageAt: new Date() },
    );
  }

  /**
   * Get the other user in a DM conversation.
   */
  async getOtherUser(
    conversationId: string,
    currentUserId: string,
  ): Promise<string | null> {
    const conversation = await this.dmRepository.findOne({
      where: { conversationId },
    });

    if (!conversation) {
      return null;
    }

    return conversation.user1Id === currentUserId
      ? conversation.user2Id
      : conversation.user1Id;
  }
}
