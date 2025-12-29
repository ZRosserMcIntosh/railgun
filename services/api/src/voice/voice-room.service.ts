import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import {
  VoiceRoomState,
  VoiceRoomParticipant,
  VideoSlotQueue,
  VideoSlotResult,
  ParticipantState,
  ProducerInfo,
} from './types';

/**
 * VoiceRoomService
 * 
 * Manages voice room state in memory and Redis.
 * Handles participant tracking, video slot queues, and room-to-SFU mapping.
 * 
 * Room stickiness: Once a room is assigned to an SFU node, all participants
 * connect to that same node until the room is empty.
 */
@Injectable()
export class VoiceRoomService {
  private readonly logger = new Logger(VoiceRoomService.name);

  // In-memory room state (authoritative for this node)
  private rooms = new Map<string, VoiceRoomState>();

  // Redis client for cross-node coordination
  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  /**
   * Get socket.io room name for a channel.
   */
  socketRoomName(channelId: string): string {
    return `voice:${channelId}`;
  }

  /**
   * Get or create a room.
   */
  async getOrCreateRoom(channelId: string, isPro: boolean): Promise<VoiceRoomState> {
    let room = this.rooms.get(channelId);

    if (!room) {
      // Check Redis for existing SFU assignment
      const sfuNodeId = await this.getSfuAssignment(channelId);

      room = {
        channelId,
        sfuNodeId: sfuNodeId || this.getLocalNodeId(),
        participants: new Map(),
        videoSlotQueue: {
          roomId: channelId,
          maxSlots: isPro ? 6 : 4,
          activePublishers: new Map(),
          waitingQueue: [],
        },
        createdAt: new Date(),
        isPro,
      };

      this.rooms.set(channelId, room);

      // Store SFU assignment in Redis if new
      if (!sfuNodeId) {
        await this.setSfuAssignment(channelId, room.sfuNodeId);
      }
    }

    return room;
  }

  /**
   * Get a room (returns undefined if not found).
   */
  getRoom(channelId: string): VoiceRoomState | undefined {
    return this.rooms.get(channelId);
  }

  /**
   * Add a participant to a room.
   */
  async addParticipant(
    channelId: string,
    data: {
      userId: string;
      deviceId: string;
      socketId: string;
      isPro: boolean;
      state: ParticipantState;
    },
  ): Promise<VoiceRoomParticipant> {
    const room = this.rooms.get(channelId);
    if (!room) {
      throw new Error('Room not found');
    }

    const participant: VoiceRoomParticipant = {
      userId: data.userId,
      deviceId: data.deviceId,
      socketId: data.socketId,
      isPro: data.isPro,
      state: data.state,
      producers: new Map(),
      consumers: new Set(),
      joinedAt: new Date(),
    };

    room.participants.set(data.userId, participant);

    this.logger.debug(`[addParticipant] channel=${channelId} user=${data.userId} total=${room.participants.size}`);

    return participant;
  }

  /**
   * Remove a participant from a room.
   * Cleans up the room if empty.
   */
  async removeParticipant(channelId: string, userId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) return;

    room.participants.delete(userId);

    // Release any video slots held by this user
    this.releaseVideoSlotsByUser(channelId, userId);

    // Clean up empty room
    if (room.participants.size === 0) {
      await this.cleanupRoom(channelId);
    }

    this.logger.debug(`[removeParticipant] channel=${channelId} user=${userId} remaining=${room.participants.size}`);
  }

  /**
   * Update participant state.
   */
  async updateParticipantState(
    channelId: string,
    userId: string,
    state: Partial<ParticipantState>,
  ): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const participant = room.participants.get(userId);
    if (!participant) return;

    participant.state = { ...participant.state, ...state };
  }

  /**
   * Get a participant.
   */
  getParticipant(channelId: string, userId: string): VoiceRoomParticipant | undefined {
    return this.rooms.get(channelId)?.participants.get(userId);
  }

  /**
   * Track a producer for a participant.
   */
  addProducer(channelId: string, userId: string, producer: ProducerInfo): void {
    const participant = this.getParticipant(channelId, userId);
    if (participant) {
      participant.producers.set(producer.producerId, producer);
    }
  }

  /**
   * Remove a producer from a participant.
   */
  removeProducer(channelId: string, userId: string, producerId: string): void {
    const participant = this.getParticipant(channelId, userId);
    if (participant) {
      participant.producers.delete(producerId);
    }
  }

  // ===========================================================================
  // Video Slot Queue (FIFO fairness policy)
  // ===========================================================================

  /**
   * Try to acquire a video slot.
   * Returns { granted: true } or { granted: false, queuePosition }.
   */
  async tryAcquireVideoSlot(
    channelId: string,
    userId: string,
    source: string,
  ): Promise<VideoSlotResult> {
    const room = this.rooms.get(channelId);
    if (!room) {
      return { granted: false, queuePosition: 0 };
    }

    const queue = room.videoSlotQueue;

    // Check if already has a slot
    for (const [, slotUserId] of queue.activePublishers) {
      if (slotUserId === userId) {
        return { granted: true }; // Already has a slot
      }
    }

    // Check if slots available
    if (queue.activePublishers.size < queue.maxSlots) {
      // Slot available - grant it (producerId will be set later)
      queue.activePublishers.set(`pending:${userId}:${source}`, userId);
      return { granted: true };
    }

    // Queue the request if not already queued
    if (!queue.waitingQueue.includes(userId)) {
      queue.waitingQueue.push(userId);
    }

    const queuePosition = queue.waitingQueue.indexOf(userId) + 1;
    return { granted: false, queuePosition };
  }

  /**
   * Finalize a video slot with the actual producer ID.
   */
  finalizeVideoSlot(channelId: string, userId: string, producerId: string, source: string): void {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const queue = room.videoSlotQueue;

    // Remove pending entry and add real one
    const pendingKey = `pending:${userId}:${source}`;
    if (queue.activePublishers.has(pendingKey)) {
      queue.activePublishers.delete(pendingKey);
      queue.activePublishers.set(producerId, userId);
    }
  }

  /**
   * Release a video slot by producer ID.
   * Promotes next user in queue if any.
   */
  async releaseVideoSlotByProducer(
    channelId: string,
    userId: string,
    producerId: string,
  ): Promise<string | undefined> {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const queue = room.videoSlotQueue;

    if (queue.activePublishers.get(producerId) === userId) {
      queue.activePublishers.delete(producerId);
      return this.promoteNextInQueue(channelId);
    }
  }

  /**
   * Release all video slots for a user.
   */
  private releaseVideoSlotsByUser(channelId: string, userId: string): void {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const queue = room.videoSlotQueue;

    // Remove from active publishers
    for (const [producerId, slotUserId] of queue.activePublishers) {
      if (slotUserId === userId) {
        queue.activePublishers.delete(producerId);
      }
    }

    // Remove from waiting queue
    const queueIndex = queue.waitingQueue.indexOf(userId);
    if (queueIndex !== -1) {
      queue.waitingQueue.splice(queueIndex, 1);
    }

    // Promote next in queue
    this.promoteNextInQueue(channelId);
  }

  /**
   * Promote the next user in the queue to an active slot.
   * Returns the userId that was promoted, or undefined.
   */
  private promoteNextInQueue(channelId: string): string | undefined {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const queue = room.videoSlotQueue;

    if (queue.waitingQueue.length > 0 && queue.activePublishers.size < queue.maxSlots) {
      const nextUserId = queue.waitingQueue.shift()!;
      // The user will need to re-request produce, but they now have priority
      // In practice, client should listen for 'video:slot:available' event
      this.logger.debug(`[promoteNextInQueue] channel=${channelId} promoted=${nextUserId}`);
      return nextUserId;
    }
  }

  /**
   * Get queue position for a user.
   */
  getQueuePosition(channelId: string, userId: string): number | null {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    const index = room.videoSlotQueue.waitingQueue.indexOf(userId);
    return index === -1 ? null : index + 1;
  }

  // ===========================================================================
  // Room-to-SFU Stickiness (Redis coordination)
  // ===========================================================================

  /**
   * Get SFU node assignment for a room from Redis.
   */
  private async getSfuAssignment(channelId: string): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.get(`voice:sfu:${channelId}`);
  }

  /**
   * Set SFU node assignment for a room in Redis.
   */
  private async setSfuAssignment(channelId: string, sfuNodeId: string): Promise<void> {
    if (!this.redis) return;
    // Set with 1 hour TTL (refreshed on activity)
    await this.redis.set(`voice:sfu:${channelId}`, sfuNodeId, 'EX', 3600);
  }

  /**
   * Clear SFU node assignment (when room is empty).
   */
  private async clearSfuAssignment(channelId: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(`voice:sfu:${channelId}`);
  }

  /**
   * Get local node ID (for single-node deployment).
   */
  private getLocalNodeId(): string {
    return this.configService.get<string>('SFU_NODE_ID') || 'sfu-local';
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up an empty room.
   */
  private async cleanupRoom(channelId: string): Promise<void> {
    this.rooms.delete(channelId);
    await this.clearSfuAssignment(channelId);
    this.logger.log(`[cleanupRoom] channel=${channelId} removed`);
  }

  /**
   * Get all rooms (for monitoring).
   */
  getAllRooms(): Map<string, VoiceRoomState> {
    return this.rooms;
  }

  /**
   * Get room count (for monitoring).
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get total participant count (for monitoring).
   */
  getTotalParticipantCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.participants.size;
    }
    return total;
  }
}
