import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from './message.entity';
import { MessageEnvelopeEntity } from './message-envelope.entity';
import { MessageStatus, ConversationType, ProtocolVersion } from '@railgun/shared';
import { DmService } from './dm.service';

/** Per-device envelope for V2 messages (internal format) */
export interface DeviceEnvelopeDto {
  recipientDeviceId: number;
  ciphertext: string;
  messageType: 'prekey' | 'message';
}

/** Input DTO for creating V2 envelopes (from gateway) */
export interface CreateEnvelopeDto {
  recipientUserId: string;
  recipientDeviceId: number;
  encryptedEnvelope: string; // Full envelope JSON from client
}

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
    @InjectRepository(MessageEnvelopeEntity)
    private readonly envelopeRepository: Repository<MessageEnvelopeEntity>,
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
   * Create a V2 DM message with per-device envelopes.
   * This is the main method used by the gateway for multi-device messages.
   */
  async createWithEnvelopes(
    senderId: string,
    dto: CreateMessageDto,
    envelopes: CreateEnvelopeDto[],
  ): Promise<MessageEntity> {
    // Create base message with V2 protocol version
    const message = await this.create(senderId, {
      ...dto,
      protocolVersion: dto.protocolVersion ?? 2,
    });

    // Store per-device envelopes
    const envelopeEntities = envelopes.map((env) =>
      this.envelopeRepository.create({
        messageId: message.id,
        recipientUserId: env.recipientUserId,
        recipientDeviceId: env.recipientDeviceId,
        encryptedEnvelope: env.encryptedEnvelope,
      }),
    );

    await this.envelopeRepository.save(envelopeEntities);

    return message;
  }

  /**
   * Create a V2 DM message with per-device envelopes (legacy signature).
   * @deprecated Use createWithEnvelopes instead.
   */
  async createV2DmMessage(
    senderId: string,
    recipientId: string,
    dto: CreateMessageDto,
    envelopes: DeviceEnvelopeDto[],
  ): Promise<MessageEntity> {
    // Create base message with V2 protocol version
    const message = await this.create(senderId, {
      ...dto,
      recipientId,
      protocolVersion: ProtocolVersion.V2_PER_DEVICE_ENVELOPES,
    });

    // Store per-device envelopes - convert legacy format to new format
    const envelopeEntities = envelopes.map((env) =>
      this.envelopeRepository.create({
        messageId: message.id,
        recipientUserId: recipientId,
        recipientDeviceId: env.recipientDeviceId,
        encryptedEnvelope: JSON.stringify({
          ciphertext: env.ciphertext,
          messageType: env.messageType,
        }),
      }),
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
    recipientDeviceId: number,
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

  /**
   * Get undelivered envelopes for a user's device.
   */
  async getUndeliveredEnvelopes(
    recipientUserId: string,
    recipientDeviceId: number,
    limit = 100,
  ): Promise<MessageEnvelopeEntity[]> {
    return this.envelopeRepository.find({
      where: {
        recipientUserId,
        recipientDeviceId,
        delivered: false,
      },
      relations: ['message'],
      order: { createdAt: 'ASC' },
      take: limit,
    });
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
   * 
   * SECURITY: Only the message recipient (or channel members for channel messages)
   * should be able to update status. The sender should also receive status updates.
   * 
   * @param id - Message ID
   * @param status - New status
   * @param userId - ID of user making the update (for authorization)
   */
  async updateStatus(
    id: string,
    status: MessageStatus,
    userId?: string,
  ): Promise<MessageEntity> {
    const message = await this.getById(id);

    // SECURITY: Validate that the user can update this message's status
    if (userId) {
      // For DMs: only participants can update status
      if (message.conversationId) {
        const isParticipant = await this.dmService.isParticipant(message.conversationId, userId);
        if (!isParticipant) {
          throw new ForbiddenException('You cannot update status for this message');
        }
      }
      // For channel messages: sender can mark as sent, but for delivered/read
      // the user must be in the channel (this is validated at controller level)
      // Here we just ensure the user is either sender or has access
      if (message.channelId && message.senderId !== userId) {
        // Non-sender marking channel message - this should be handled by channel access check
        // For now, allow it since channel access is checked at controller level
      }
    }

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
   * 
   * SECURITY: Validates that the user has access to all messages before updating
   * 
   * @param messageIds - IDs of messages to update
   * @param status - New status
   * @param userId - ID of user making the update (for authorization)
   */
  async batchUpdateStatus(
    messageIds: string[],
    status: MessageStatus,
    userId?: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    // SECURITY: If userId provided, validate access to all messages
    if (userId) {
      for (const messageId of messageIds) {
        const message = await this.getById(messageId);
        
        // For DMs: only participants can update status
        if (message.conversationId) {
          const isParticipant = await this.dmService.isParticipant(message.conversationId, userId);
          if (!isParticipant) {
            throw new ForbiddenException(`You cannot update status for message ${messageId}`);
          }
        }
        // Channel messages are validated at controller level
      }
    }

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
