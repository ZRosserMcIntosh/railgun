import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from './message.entity';
import { MessageStatus, ConversationType } from '@railgun/shared';
import { DmService } from './dm.service';

/** DTO for creating a message */
export interface CreateMessageDto {
  channelId?: string;
  recipientId?: string; // For DMs
  encryptedEnvelope: string;
  clientNonce: string;
  protocolVersion?: number;
  replyToId?: string;
}

/** DTO for message response */
export interface MessageResponseDto {
  id: string;
  senderId: string;
  channelId?: string;
  conversationId?: string;
  conversationType: ConversationType;
  encryptedEnvelope: string;
  protocolVersion: number;
  status: MessageStatus;
  replyToId?: string;
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @Inject(forwardRef(() => DmService))
    private readonly dmService: DmService,
  ) {}

  /**
   * Create and store a new encrypted message.
   */
  async create(senderId: string, dto: CreateMessageDto): Promise<MessageEntity> {
    let conversationType = ConversationType.CHANNEL;
    let conversationId: string | undefined;

    // Determine conversation type
    if (dto.recipientId && !dto.channelId) {
      conversationType = ConversationType.DM;
      // Use DmService to get the HMAC-derived conversation ID
      // This ensures consistency across WebSocket rooms and message storage
      const isSelfDm = senderId === dto.recipientId;
      conversationId = isSelfDm
        ? this.dmService.generateSelfDmId(senderId)
        : this.dmService.generateConversationId(senderId, dto.recipientId);
    }

    const message = this.messageRepository.create({
      senderId,
      channelId: dto.channelId,
      conversationId,
      conversationType,
      encryptedEnvelope: dto.encryptedEnvelope,
      clientNonce: dto.clientNonce,
      protocolVersion: dto.protocolVersion ?? 1,
      replyToId: dto.replyToId,
      status: MessageStatus.SENT,
    });

    return this.messageRepository.save(message);
  }

  /**
   * Get messages for a channel with pagination.
   */
  async getChannelMessages(
    channelId: string,
    limit = 50,
    before?: string,
  ): Promise<MessageEntity[]> {
    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .where('message.channelId = :channelId', { channelId })
      .andWhere('message.isDeleted = false')
      .orderBy('message.createdAt', 'DESC')
      .take(limit);

    if (before) {
      const beforeMessage = await this.messageRepository.findOne({
        where: { id: before },
        select: ['createdAt'],
      });
      if (beforeMessage) {
        queryBuilder.andWhere('message.createdAt < :beforeDate', {
          beforeDate: beforeMessage.createdAt,
        });
      }
    }

    const messages = await queryBuilder.getMany();
    return messages.reverse(); // Return in chronological order
  }

  /**
   * Get DM messages between two users.
   */
  async getDmMessages(
    userId1: string,
    userId2: string,
    limit = 50,
    before?: string,
  ): Promise<MessageEntity[]> {
    // Use HMAC-derived conversation ID for lookup
    const isSelfDm = userId1 === userId2;
    const conversationId = isSelfDm
      ? this.dmService.generateSelfDmId(userId1)
      : this.dmService.generateConversationId(userId1, userId2);

    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('message.isDeleted = false')
      .orderBy('message.createdAt', 'DESC')
      .take(limit);

    if (before) {
      const beforeMessage = await this.messageRepository.findOne({
        where: { id: before },
        select: ['createdAt'],
      });
      if (beforeMessage) {
        queryBuilder.andWhere('message.createdAt < :beforeDate', {
          beforeDate: beforeMessage.createdAt,
        });
      }
    }

    const messages = await queryBuilder.getMany();
    return messages.reverse();
  }

  /**
   * Get a single message by ID.
   */
  async getById(id: string): Promise<MessageEntity> {
    const message = await this.messageRepository.findOne({
      where: { id },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  /**
   * Update message status (delivered, read).
   */
  async updateStatus(
    id: string,
    status: MessageStatus,
  ): Promise<MessageEntity> {
    const message = await this.getById(id);

    message.status = status;

    if (status === MessageStatus.DELIVERED) {
      message.deliveredAt = new Date();
    } else if (status === MessageStatus.READ) {
      message.readAt = new Date();
    }

    return this.messageRepository.save(message);
  }

  /**
   * Soft delete a message.
   */
  async delete(id: string, userId: string): Promise<void> {
    const message = await this.getById(id);

    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot delete message from another user');
    }

    message.isDeleted = true;
    await this.messageRepository.save(message);
  }

  /**
   * Edit a message (updates encrypted envelope).
   */
  async edit(
    id: string,
    userId: string,
    newEncryptedEnvelope: string,
  ): Promise<MessageEntity> {
    const message = await this.getById(id);

    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot edit message from another user');
    }

    message.encryptedEnvelope = newEncryptedEnvelope;
    message.isEdited = true;

    return this.messageRepository.save(message);
  }

  /**
   * Get undelivered messages for a user (for offline sync).
   */
  async getUndeliveredMessages(
    userId: string,
    channelIds: string[],
  ): Promise<MessageEntity[]> {
    if (channelIds.length === 0) {
      return [];
    }

    return this.messageRepository
      .createQueryBuilder('message')
      .where('message.channelId IN (:...channelIds)', { channelIds })
      .andWhere('message.senderId != :userId', { userId })
      .andWhere('message.status = :status', { status: MessageStatus.SENT })
      .andWhere('message.isDeleted = false')
      .orderBy('message.createdAt', 'ASC')
      .getMany();
  }

  /**
   * Batch update message statuses (for marking multiple as delivered/read).
   */
  async batchUpdateStatus(
    messageIds: string[],
    status: MessageStatus,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    const updateData: Partial<MessageEntity> = { status };

    if (status === MessageStatus.DELIVERED) {
      updateData.deliveredAt = new Date();
    } else if (status === MessageStatus.READ) {
      updateData.readAt = new Date();
    }

    await this.messageRepository
      .createQueryBuilder()
      .update(MessageEntity)
      .set(updateData)
      .whereInIds(messageIds)
      .execute();
  }

  /**
   * Check if a message with this client nonce already exists (deduplication).
   */
  async existsByClientNonce(
    senderId: string,
    clientNonce: string,
  ): Promise<MessageEntity | null> {
    return this.messageRepository.findOne({
      where: { senderId, clientNonce },
    });
  }
}
