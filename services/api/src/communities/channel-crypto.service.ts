import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SenderKeyDistributionEntity } from './sender-key-distribution.entity';
import { ChannelEntity } from './channel.entity';
import { MemberEntity } from './member.entity';

export interface ChannelMemberDto {
  userId: string;
  username: string;
  displayName: string;
  deviceId: number;
}

export interface SenderKeyDistributionDto {
  senderUserId: string;
  senderDeviceId: number;
  distribution: string;
  createdAt: string;
}

/**
 * Service for channel-level crypto operations.
 * Handles sender key distribution for E2E encrypted group messaging.
 */
@Injectable()
export class ChannelCryptoService {
  constructor(
    @InjectRepository(SenderKeyDistributionEntity)
    private readonly senderKeyRepo: Repository<SenderKeyDistributionEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepo: Repository<ChannelEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepo: Repository<MemberEntity>,
  ) {}

  /**
   * Get all members of a channel (via community membership).
   * Returns user info + their primary device ID for sender key distribution.
   */
  async getChannelMembers(
    channelId: string,
    requestingUserId: string,
  ): Promise<ChannelMemberDto[]> {
    // Get the channel and its community
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['community'],
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Verify requesting user is a member of the community
    const requestingMember = await this.memberRepo.findOne({
      where: {
        communityId: channel.communityId,
        userId: requestingUserId,
      },
    });

    if (!requestingMember) {
      throw new ForbiddenException('Not a member of this community');
    }

    // Get all community members with their user info
    const members = await this.memberRepo.find({
      where: { communityId: channel.communityId },
      relations: ['user'],
    });

    // Return members with default device ID
    // TODO: Look up actual device IDs from crypto module when needed
    return members.map((member) => ({
      userId: member.userId,
      username: member.user.username,
      displayName: member.user.displayName || member.user.username,
      deviceId: 1, // Default device ID - client should fetch actual devices if needed
    }));
  }

  /**
   * Store a sender key distribution for a recipient.
   */
  async storeSenderKeyDistribution(
    channelId: string,
    senderUserId: string,
    senderDeviceId: number,
    recipientUserId: string,
    distribution: string,
  ): Promise<void> {
    // Verify channel exists
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Verify both users are members
    const senderMember = await this.memberRepo.findOne({
      where: {
        communityId: channel.communityId,
        userId: senderUserId,
      },
    });

    if (!senderMember) {
      throw new ForbiddenException('Sender is not a member of this community');
    }

    const recipientMember = await this.memberRepo.findOne({
      where: {
        communityId: channel.communityId,
        userId: recipientUserId,
      },
    });

    if (!recipientMember) {
      throw new ForbiddenException('Recipient is not a member of this community');
    }

    // Remove any existing distribution from this sender to this recipient for this channel
    await this.senderKeyRepo.delete({
      channelId,
      senderUserId,
      recipientUserId,
    });

    // Store new distribution
    const entity = this.senderKeyRepo.create({
      channelId,
      senderUserId,
      senderDeviceId,
      recipientUserId,
      distribution,
    });

    await this.senderKeyRepo.save(entity);
  }

  /**
   * Get pending sender key distributions for a user in a channel.
   */
  async getPendingSenderKeys(
    channelId: string,
    recipientUserId: string,
  ): Promise<SenderKeyDistributionDto[]> {
    const distributions = await this.senderKeyRepo.find({
      where: {
        channelId,
        recipientUserId,
      },
      order: { createdAt: 'ASC' },
    });

    // Delete distributions after fetching (one-time delivery)
    if (distributions.length > 0) {
      await this.senderKeyRepo.delete({
        channelId,
        recipientUserId,
      });
    }

    return distributions.map((d) => ({
      senderUserId: d.senderUserId,
      senderDeviceId: d.senderDeviceId,
      distribution: d.distribution,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
