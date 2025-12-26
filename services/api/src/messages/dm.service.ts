import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class DmService {
  constructor(
    @InjectRepository(DmConversationEntity)
    private readonly dmRepository: Repository<DmConversationEntity>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Generate deterministic conversation ID from two user IDs.
   * Sorts IDs alphabetically to ensure consistency.
   */
  generateConversationId(userId1: string, userId2: string): string {
    const sorted = [userId1, userId2].sort();
    return `${sorted[0]}:${sorted[1]}`;
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
    
    const conversationId = isSelfDm
      ? `self:${currentUserId}` // Special format for self-DMs
      : this.generateConversationId(currentUserId, targetUser.id);
    
    const sortedIds = [currentUserId, targetUser.id].sort();

    // Check if conversation already exists
    let conversation = await this.dmRepository.findOne({
      where: { conversationId },
    });

    if (conversation) {
      return {
        conversationId: conversation.conversationId,
        peerId: targetUser.id,
        isNew: false,
      };
    }

    // Create new conversation
    conversation = this.dmRepository.create({
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
    
    const conversationId = isSelfDm 
      ? `self:${currentUserId}` // Special format for self-DMs
      : this.generateConversationId(currentUserId, targetUser.id);
    
    const sortedIds = [currentUserId, targetUser.id].sort();

    // Check if conversation already exists
    let conversation = await this.dmRepository.findOne({
      where: { conversationId },
    });

    if (conversation) {
      return {
        conversationId: conversation.conversationId,
        peerId: targetUser.id,
        isNew: false,
      };
    }

    // Create new conversation
    conversation = this.dmRepository.create({
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
