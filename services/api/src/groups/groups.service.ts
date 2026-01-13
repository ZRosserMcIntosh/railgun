import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Permission } from '@railgun/shared';

import { CommunityEntity, JoinPolicy, PostPolicy, GroupType } from '../communities/community.entity';
import { MemberEntity } from '../communities/member.entity';
import { GroupPlanEntity, BillingInterval } from './entities/group-plan.entity';
import { GroupMembershipEntity, MembershipStatus, PaymentSource } from './entities/group-membership.entity';
import { GroupJoinRequestEntity, JoinRequestStatus } from './entities/group-join-request.entity';
import { StripeConnectAccountEntity } from './entities/stripe-connect-account.entity';
import { CommunitiesService } from '../communities/communities.service';

// ============================================================================
// DTOs
// ============================================================================

export interface UpdateGroupPoliciesDto {
  joinPolicy?: JoinPolicy;
  postPolicy?: PostPolicy;
  isPublic?: boolean;
  isDiscoverable?: boolean;
  handle?: string;
  groupType?: GroupType;
}

export interface CreateGroupPlanDto {
  priceCents: number;
  currency?: string;
  interval: BillingInterval;
}

export interface JoinGroupDto {
  message?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);
  private readonly stripe: Stripe | null = null;
  private readonly isStripeConfigured: boolean = false;
  private readonly platformFeePercent = 10; // 10% commission

  constructor(
    @InjectRepository(CommunityEntity)
    private readonly communityRepository: Repository<CommunityEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(GroupPlanEntity)
    private readonly groupPlanRepository: Repository<GroupPlanEntity>,
    @InjectRepository(GroupMembershipEntity)
    private readonly groupMembershipRepository: Repository<GroupMembershipEntity>,
    @InjectRepository(GroupJoinRequestEntity)
    private readonly joinRequestRepository: Repository<GroupJoinRequestEntity>,
    @InjectRepository(StripeConnectAccountEntity)
    private readonly stripeConnectRepository: Repository<StripeConnectAccountEntity>,
    private readonly configService: ConfigService,
    private readonly communitiesService: CommunitiesService,
  ) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2024-11-20.acacia' as Stripe.LatestApiVersion,
      });
      this.isStripeConfigured = true;
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set - paid groups features disabled');
    }
  }

  private ensureStripeConfigured(): void {
    if (!this.isStripeConfigured || !this.stripe) {
      throw new BadRequestException('Stripe is not configured - paid groups are disabled');
    }
  }

  // ============================================================================
  // GROUP POLICIES
  // ============================================================================

  /**
   * Update group policies (join policy, post policy, etc.)
   */
  async updateGroupPolicies(
    communityId: string,
    userId: string,
    dto: UpdateGroupPoliciesDto,
  ): Promise<CommunityEntity> {
    const community = await this.getCommunity(communityId);
    
    // Only owner or admins can update policies
    if (community.ownerId !== userId) {
      const member = await this.communitiesService.getMember(communityId, userId);
      if (!this.communitiesService.hasPermission(member, Permission.MANAGE_COMMUNITY)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    // Validate handle if provided
    if (dto.handle !== undefined) {
      if (dto.handle) {
        // Validate handle format
        if (!/^[a-zA-Z0-9_-]{3,32}$/.test(dto.handle)) {
          throw new BadRequestException(
            'Handle must be 3-32 characters and contain only letters, numbers, hyphens, and underscores'
          );
        }
        
        // Check if handle is taken
        const existing = await this.communityRepository.findOne({
          where: { handle: dto.handle },
        });
        if (existing && existing.id !== communityId) {
          throw new ConflictException('This handle is already taken');
        }
      }
      community.handle = dto.handle || undefined;
    }

    // Update other fields
    if (dto.joinPolicy !== undefined) {
      community.joinPolicy = dto.joinPolicy;
    }
    if (dto.postPolicy !== undefined) {
      community.postPolicy = dto.postPolicy;
    }
    if (dto.isPublic !== undefined) {
      community.isPublic = dto.isPublic;
    }
    if (dto.isDiscoverable !== undefined) {
      community.isDiscoverable = dto.isDiscoverable;
    }
    if (dto.groupType !== undefined) {
      community.groupType = dto.groupType;
    }

    return this.communityRepository.save(community);
  }

  /**
   * Get group by handle.
   */
  async getGroupByHandle(handle: string): Promise<CommunityEntity> {
    const community = await this.communityRepository.findOne({
      where: { handle },
      relations: ['owner'],
    });

    if (!community) {
      throw new NotFoundException('Group not found');
    }

    return community;
  }

  /**
   * Get discoverable groups.
   */
  async getDiscoverableGroups(
    cursor?: string,
    limit: number = 20,
  ): Promise<{ groups: CommunityEntity[]; cursor?: string }> {
    const query = this.communityRepository
      .createQueryBuilder('community')
      .where('community.isDiscoverable = :discoverable', { discoverable: true })
      .andWhere('community.isPublic = :public', { public: true })
      .orderBy('community.memberCount', 'DESC')
      .take(limit + 1);

    if (cursor) {
      query.andWhere('community.id > :cursor', { cursor });
    }

    const groups = await query.getMany();
    
    const hasMore = groups.length > limit;
    if (hasMore) {
      groups.pop();
    }

    return {
      groups,
      cursor: hasMore ? groups[groups.length - 1]?.id : undefined,
    };
  }

  // ============================================================================
  // JOIN FLOW
  // ============================================================================

  /**
   * Request to join a group.
   */
  async joinGroup(
    communityId: string,
    userId: string,
    dto: JoinGroupDto,
  ): Promise<{
    joined: boolean;
    requestId?: string;
    checkoutUrl?: string;
    appleProductId?: string;
    googleProductId?: string;
    message: string;
  }> {
    const community = await this.getCommunity(communityId);

    // Check if already a member
    const existingMember = await this.memberRepository.findOne({
      where: { communityId, userId },
    });
    if (existingMember) {
      return { joined: true, message: 'Already a member' };
    }

    // Handle based on join policy
    switch (community.joinPolicy) {
      case JoinPolicy.OPEN:
        await this.addMember(communityId, userId);
        return { joined: true, message: 'Successfully joined the group' };

      case JoinPolicy.APPROVAL_REQUIRED:
        const request = await this.createJoinRequest(communityId, userId, dto.message);
        return {
          joined: false,
          requestId: request.id,
          message: 'Your request to join has been submitted for approval',
        };

      case JoinPolicy.INVITE_ONLY:
        throw new ForbiddenException('This group requires an invite to join');

      case JoinPolicy.PAID:
        return this.handlePaidGroupJoin(community, userId);

      default:
        throw new BadRequestException('Unknown join policy');
    }
  }

  /**
   * Handle paid group join - returns checkout info.
   */
  private async handlePaidGroupJoin(
    community: CommunityEntity,
    userId: string,
  ): Promise<{
    joined: boolean;
    checkoutUrl?: string;
    appleProductId?: string;
    googleProductId?: string;
    message: string;
  }> {
    const plan = await this.getGroupPlan(community.id);
    if (!plan) {
      throw new BadRequestException('This paid group has no active plan');
    }

    // Check for existing active membership
    const existingMembership = await this.groupMembershipRepository.findOne({
      where: { communityId: community.id, userId },
    });
    if (existingMembership?.hasAccess()) {
      await this.addMember(community.id, userId);
      return { joined: true, message: 'Membership restored' };
    }

    // Return payment options
    return {
      joined: false,
      checkoutUrl: plan.stripePriceId 
        ? await this.createCheckoutSession(community.id, userId, plan)
        : undefined,
      appleProductId: plan.appleProductId,
      googleProductId: plan.googleProductId,
      message: `This group requires a subscription of ${plan.getFormattedPrice()} to join`,
    };
  }

  /**
   * Create a join request for approval-required groups.
   */
  private async createJoinRequest(
    communityId: string,
    userId: string,
    message?: string,
  ): Promise<GroupJoinRequestEntity> {
    // Check for existing pending request
    const existing = await this.joinRequestRepository.findOne({
      where: { communityId, userId, status: JoinRequestStatus.PENDING },
    });
    if (existing) {
      return existing;
    }

    const request = this.joinRequestRepository.create({
      communityId,
      userId,
      message,
      status: JoinRequestStatus.PENDING,
    });

    return this.joinRequestRepository.save(request);
  }

  /**
   * Get pending join requests for a group.
   */
  async getJoinRequests(
    communityId: string,
    userId: string,
  ): Promise<GroupJoinRequestEntity[]> {
    const community = await this.getCommunity(communityId);
    
    // Check permissions
    if (community.ownerId !== userId) {
      const member = await this.communitiesService.getMember(communityId, userId);
      if (!this.communitiesService.hasPermission(member, Permission.MANAGE_MEMBERS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return this.joinRequestRepository.find({
      where: { communityId, status: JoinRequestStatus.PENDING },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Approve a join request.
   */
  async approveJoinRequest(
    requestId: string,
    reviewerId: string,
  ): Promise<GroupJoinRequestEntity> {
    const request = await this.joinRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    const community = await this.getCommunity(request.communityId);
    
    // Check permissions
    if (community.ownerId !== reviewerId) {
      const member = await this.communitiesService.getMember(request.communityId, reviewerId);
      if (!this.communitiesService.hasPermission(member, Permission.MANAGE_MEMBERS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    request.approve(reviewerId);
    await this.joinRequestRepository.save(request);

    // Add user as member
    await this.addMember(request.communityId, request.userId);

    return request;
  }

  /**
   * Reject a join request.
   */
  async rejectJoinRequest(
    requestId: string,
    reviewerId: string,
  ): Promise<GroupJoinRequestEntity> {
    const request = await this.joinRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    const community = await this.getCommunity(request.communityId);
    
    // Check permissions
    if (community.ownerId !== reviewerId) {
      const member = await this.communitiesService.getMember(request.communityId, reviewerId);
      if (!this.communitiesService.hasPermission(member, Permission.MANAGE_MEMBERS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    request.reject(reviewerId);
    return this.joinRequestRepository.save(request);
  }

  // ============================================================================
  // GROUP PLANS (PRICING)
  // ============================================================================

  /**
   * Create or update a group plan.
   */
  async createOrUpdateGroupPlan(
    communityId: string,
    userId: string,
    dto: CreateGroupPlanDto,
  ): Promise<GroupPlanEntity> {
    const community = await this.getCommunity(communityId);
    
    // Only owner can create plans
    if (community.ownerId !== userId) {
      throw new ForbiddenException('Only the group owner can create pricing plans');
    }

    // Check if owner has Stripe Connect
    const stripeAccount = await this.stripeConnectRepository.findOne({
      where: { userId },
    });
    if (!stripeAccount?.isReady()) {
      throw new BadRequestException(
        'You must connect a Stripe account before creating a paid group'
      );
    }

    // Check for existing plan
    let plan = await this.groupPlanRepository.findOne({
      where: { communityId },
    });

    if (plan) {
      // Update existing plan
      plan.priceCents = dto.priceCents;
      plan.currency = dto.currency || 'USD';
      plan.interval = dto.interval;
    } else {
      // Create new plan
      plan = this.groupPlanRepository.create({
        communityId,
        priceCents: dto.priceCents,
        currency: dto.currency || 'USD',
        interval: dto.interval,
      });
    }

    // Ensure Stripe is configured for paid groups
    this.ensureStripeConfigured();

    // Create Stripe Product and Price
    const stripeProduct = await this.stripe!.products.create(
      {
        name: `${community.name} Membership`,
        description: community.description || `Access to ${community.name}`,
        metadata: {
          communityId,
          planId: plan.id || 'pending',
        },
      },
      { stripeAccount: stripeAccount.stripeAccountId },
    );

    const stripePrice = await this.stripe!.prices.create(
      {
        product: stripeProduct.id,
        unit_amount: dto.priceCents,
        currency: (dto.currency || 'USD').toLowerCase(),
        recurring: dto.interval !== BillingInterval.ONE_TIME
          ? { interval: dto.interval === BillingInterval.MONTHLY ? 'month' : 'year' }
          : undefined,
        metadata: {
          communityId,
        },
      },
      { stripeAccount: stripeAccount.stripeAccountId },
    );

    plan.stripeProductId = stripeProduct.id;
    plan.stripePriceId = stripePrice.id;

    // Update community to be a paid group
    community.joinPolicy = JoinPolicy.PAID;
    community.groupType = GroupType.PAID;
    await this.communityRepository.save(community);

    return this.groupPlanRepository.save(plan);
  }

  /**
   * Get group plan.
   */
  async getGroupPlan(communityId: string): Promise<GroupPlanEntity | null> {
    return this.groupPlanRepository.findOne({
      where: { communityId, isActive: true },
    });
  }

  /**
   * Delete group plan (makes group free).
   */
  async deleteGroupPlan(
    communityId: string,
    userId: string,
  ): Promise<void> {
    const community = await this.getCommunity(communityId);
    
    if (community.ownerId !== userId) {
      throw new ForbiddenException('Only the group owner can delete the pricing plan');
    }

    const plan = await this.getGroupPlan(communityId);
    if (plan) {
      plan.isActive = false;
      await this.groupPlanRepository.save(plan);
    }

    // Update community
    community.joinPolicy = JoinPolicy.OPEN;
    community.groupType = GroupType.FULL;
    await this.communityRepository.save(community);
  }

  // ============================================================================
  // STRIPE CHECKOUT
  // ============================================================================

  /**
   * Create Stripe Checkout session for paid group.
   */
  private async createCheckoutSession(
    communityId: string,
    userId: string,
    plan: GroupPlanEntity,
  ): Promise<string> {
    const community = await this.getCommunity(communityId);
    const ownerAccount = await this.stripeConnectRepository.findOne({
      where: { userId: community.ownerId },
    });

    if (!ownerAccount || !plan.stripePriceId) {
      throw new BadRequestException('Payment not configured for this group');
    }

    this.ensureStripeConfigured();
    
    const baseUrl = this.configService.get<string>('APP_URL') || 'https://railgun.app';
    
    // Calculate application fee (10%)
    const applicationFeePercent = this.platformFeePercent;

    const session = await this.stripe!.checkout.sessions.create({
      mode: plan.interval === BillingInterval.ONE_TIME ? 'payment' : 'subscription',
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      payment_intent_data: plan.interval === BillingInterval.ONE_TIME
        ? {
            application_fee_amount: Math.round(plan.priceCents * applicationFeePercent / 100),
            transfer_data: {
              destination: ownerAccount.stripeAccountId,
            },
          }
        : undefined,
      subscription_data: plan.interval !== BillingInterval.ONE_TIME
        ? {
            application_fee_percent: applicationFeePercent,
            transfer_data: {
              destination: ownerAccount.stripeAccountId,
            },
            metadata: {
              communityId,
              userId,
              planId: plan.id,
            },
          }
        : undefined,
      success_url: `${baseUrl}/groups/${communityId}?joined=true`,
      cancel_url: `${baseUrl}/groups/${communityId}?canceled=true`,
      metadata: {
        communityId,
        userId,
        planId: plan.id,
        type: 'group_membership',
      },
    });

    return session.url || '';
  }

  /**
   * Handle successful Stripe payment webhook.
   */
  async handleStripePaymentSuccess(
    communityId: string,
    userId: string,
    planId: string,
    subscriptionId: string,
    expiresAt?: Date,
  ): Promise<void> {
    // Create or update membership
    let membership = await this.groupMembershipRepository.findOne({
      where: { communityId, userId },
    });

    if (membership) {
      membership.status = MembershipStatus.ACTIVE;
      membership.externalSubscriptionId = subscriptionId;
      membership.expiresAt = expiresAt;
    } else {
      membership = this.groupMembershipRepository.create({
        communityId,
        userId,
        groupPlanId: planId,
        paymentSource: PaymentSource.STRIPE,
        externalSubscriptionId: subscriptionId,
        status: MembershipStatus.ACTIVE,
        expiresAt,
      });
    }

    await this.groupMembershipRepository.save(membership);

    // Add as community member
    await this.addMember(communityId, userId);

    this.logger.log(`Activated paid membership for user ${userId} in group ${communityId}`);
  }

  // ============================================================================
  // IAP VERIFICATION
  // ============================================================================

  /**
   * Verify Apple IAP receipt and activate membership.
   */
  async verifyApplePurchase(
    communityId: string,
    userId: string,
    receipt: string,
    productId: string,
  ): Promise<GroupMembershipEntity> {
    const plan = await this.getGroupPlan(communityId);
    if (!plan || plan.appleProductId !== productId) {
      throw new BadRequestException('Invalid product for this group');
    }

    // TODO: Implement Apple receipt verification
    // For now, we'll trust the receipt (in production, verify with Apple's servers)
    this.logger.warn('Apple IAP verification not fully implemented - trusting receipt');

    // Create membership
    const membership = this.groupMembershipRepository.create({
      communityId,
      userId,
      groupPlanId: plan.id,
      paymentSource: PaymentSource.APPLE_IAP,
      externalSubscriptionId: receipt.substring(0, 255), // Store truncated receipt as reference
      status: MembershipStatus.ACTIVE,
    });

    await this.groupMembershipRepository.save(membership);
    await this.addMember(communityId, userId);

    return membership;
  }

  /**
   * Verify Google Play purchase and activate membership.
   */
  async verifyGooglePurchase(
    communityId: string,
    userId: string,
    purchaseToken: string,
    productId: string,
  ): Promise<GroupMembershipEntity> {
    const plan = await this.getGroupPlan(communityId);
    if (!plan || plan.googleProductId !== productId) {
      throw new BadRequestException('Invalid product for this group');
    }

    // TODO: Implement Google Play verification
    // For now, we'll trust the purchase (in production, verify with Google's servers)
    this.logger.warn('Google Play verification not fully implemented - trusting purchase');

    // Create membership
    const membership = this.groupMembershipRepository.create({
      communityId,
      userId,
      groupPlanId: plan.id,
      paymentSource: PaymentSource.GOOGLE_PLAY,
      externalSubscriptionId: purchaseToken.substring(0, 255),
      status: MembershipStatus.ACTIVE,
    });

    await this.groupMembershipRepository.save(membership);
    await this.addMember(communityId, userId);

    return membership;
  }

  // ============================================================================
  // POST PERMISSION CHECKING
  // ============================================================================

  /**
   * Check if a user can post in a group.
   */
  async canUserPost(communityId: string, userId: string): Promise<boolean> {
    const community = await this.getCommunity(communityId);

    // Owner can always post
    if (community.ownerId === userId) {
      return true;
    }

    const member = await this.memberRepository.findOne({
      where: { communityId, userId },
      relations: ['role'],
    });

    if (!member) {
      return false;
    }

    switch (community.postPolicy) {
      case PostPolicy.OPEN:
        return true;

      case PostPolicy.OWNER_ONLY:
        return false;

      case PostPolicy.ROLE_BASED:
        if (!member.role) return false;
        return (
          member.role.permissions.includes(Permission.ADMINISTRATOR) ||
          member.role.permissions.includes(Permission.SEND_MESSAGES) ||
          (member.role.permissions as string[]).includes('POST_MESSAGES')
        );

      default:
        return true;
    }
  }

  // ============================================================================
  // MEMBERSHIP STATUS
  // ============================================================================

  /**
   * Get user's membership in a group.
   */
  async getMembership(
    communityId: string,
    userId: string,
  ): Promise<GroupMembershipEntity | null> {
    return this.groupMembershipRepository.findOne({
      where: { communityId, userId },
      relations: ['groupPlan'],
    });
  }

  /**
   * Check if user has active paid membership.
   */
  async hasActiveMembership(communityId: string, userId: string): Promise<boolean> {
    const membership = await this.getMembership(communityId, userId);
    return membership?.hasAccess() || false;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async getCommunity(id: string): Promise<CommunityEntity> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });
    if (!community) {
      throw new NotFoundException('Community not found');
    }
    return community;
  }

  private async addMember(communityId: string, userId: string): Promise<void> {
    // Check if already a member
    const existing = await this.memberRepository.findOne({
      where: { communityId, userId },
    });
    if (existing) return;

    // Add member using communities service joinCommunity method
    // This handles role assignment and member count updates
    try {
      await this.communitiesService.joinCommunity(communityId, userId);
    } catch (error) {
      // ConflictException means already a member, which is fine
      if (!(error instanceof ConflictException)) {
        throw error;
      }
    }
  }
}
