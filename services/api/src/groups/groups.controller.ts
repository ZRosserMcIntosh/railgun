import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Res,
  Headers,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GroupsService, UpdateGroupPoliciesDto, CreateGroupPlanDto, JoinGroupDto } from './groups.service';
import { StripeConnectService } from './stripe-connect.service';
import { JoinPolicy } from '../communities/community.entity';
import { PaymentSource } from './entities/group-membership.entity';

interface AuthRequest {
  user: {
    id: string;
    username: string;
  };
}

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
  ) {}

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  /**
   * Get discoverable groups.
   * GET /groups/discover
   */
  @Get('discover')
  async discoverGroups(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.groupsService.getDiscoverableGroups(
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );

    return {
      groups: result.groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        iconUrl: g.iconUrl,
        handle: g.handle,
        groupType: g.groupType,
        joinPolicy: g.joinPolicy,
        memberCount: g.memberCount,
      })),
      cursor: result.cursor,
    };
  }

  /**
   * Get group by handle.
   * GET /groups/handle/:handle
   */
  @Get('handle/:handle')
  async getGroupByHandle(@Param('handle') handle: string) {
    const group = await this.groupsService.getGroupByHandle(handle);
    
    // Get plan if it's a paid group
    const plan = group.joinPolicy === JoinPolicy.PAID
      ? await this.groupsService.getGroupPlan(group.id)
      : null;

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      iconUrl: group.iconUrl,
      ownerId: group.ownerId,
      handle: group.handle,
      groupType: group.groupType,
      joinPolicy: group.joinPolicy,
      postPolicy: group.postPolicy,
      isPublic: group.isPublic,
      isDiscoverable: group.isDiscoverable,
      memberCount: group.memberCount,
      plan: plan ? {
        id: plan.id,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        formattedPrice: plan.getFormattedPrice(),
      } : null,
    };
  }

  // ============================================================================
  // GROUP POLICIES
  // ============================================================================

  /**
   * Get group policies.
   * GET /groups/:id/policies
   */
  @Get(':id/policies')
  @UseGuards(JwtAuthGuard)
  async getPolicies(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    const group = await this.groupsService.getGroupByHandle(id).catch(() => null)
      || await this.groupsService['getCommunity'](id);

    const canPost = await this.groupsService.canUserPost(group.id, req.user.id);
    const membership = await this.groupsService.getMembership(group.id, req.user.id);

    return {
      joinPolicy: group.joinPolicy,
      postPolicy: group.postPolicy,
      groupType: group.groupType,
      isPublic: group.isPublic,
      isDiscoverable: group.isDiscoverable,
      handle: group.handle,
      permissions: {
        canPost,
        canManage: group.ownerId === req.user.id,
      },
      membership: membership ? {
        status: membership.status,
        expiresAt: membership.expiresAt,
      } : null,
    };
  }

  /**
   * Update group policies.
   * PATCH /groups/:id/policies
   */
  @Patch(':id/policies')
  @UseGuards(JwtAuthGuard)
  async updatePolicies(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateGroupPoliciesDto,
  ) {
    const group = await this.groupsService.updateGroupPolicies(
      id,
      req.user.id,
      dto,
    );

    return {
      success: true,
      policies: {
        joinPolicy: group.joinPolicy,
        postPolicy: group.postPolicy,
        groupType: group.groupType,
        isPublic: group.isPublic,
        isDiscoverable: group.isDiscoverable,
        handle: group.handle,
      },
    };
  }

  // ============================================================================
  // JOIN FLOW
  // ============================================================================

  /**
   * Join a group.
   * POST /groups/:id/join
   */
  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  async joinGroup(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: JoinGroupDto,
  ) {
    return this.groupsService.joinGroup(id, req.user.id, dto);
  }

  /**
   * Get pending join requests.
   * GET /groups/:id/join-requests
   */
  @Get(':id/join-requests')
  @UseGuards(JwtAuthGuard)
  async getJoinRequests(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    const requests = await this.groupsService.getJoinRequests(id, req.user.id);
    
    return {
      requests: requests.map((r) => ({
        id: r.id,
        userId: r.userId,
        username: r.user?.username,
        displayName: r.user?.displayName,
        avatarUrl: r.user?.avatarUrl,
        message: r.message,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Approve a join request.
   * POST /groups/:id/join-requests/:requestId/approve
   */
  @Post(':id/join-requests/:requestId/approve')
  @UseGuards(JwtAuthGuard)
  async approveJoinRequest(
    @Request() req: AuthRequest,
    @Param('requestId') requestId: string,
  ) {
    const request = await this.groupsService.approveJoinRequest(
      requestId,
      req.user.id,
    );

    return {
      success: true,
      request: {
        id: request.id,
        status: request.status,
        reviewedAt: request.reviewedAt,
      },
    };
  }

  /**
   * Reject a join request.
   * POST /groups/:id/join-requests/:requestId/reject
   */
  @Post(':id/join-requests/:requestId/reject')
  @UseGuards(JwtAuthGuard)
  async rejectJoinRequest(
    @Request() req: AuthRequest,
    @Param('requestId') requestId: string,
  ) {
    const request = await this.groupsService.rejectJoinRequest(
      requestId,
      req.user.id,
    );

    return {
      success: true,
      request: {
        id: request.id,
        status: request.status,
        reviewedAt: request.reviewedAt,
      },
    };
  }

  // ============================================================================
  // GROUP PLANS (PRICING)
  // ============================================================================

  /**
   * Get group plan.
   * GET /groups/:id/plan
   */
  @Get(':id/plan')
  async getGroupPlan(@Param('id') id: string) {
    const plan = await this.groupsService.getGroupPlan(id);
    
    if (!plan) {
      return { plan: null };
    }

    return {
      plan: {
        id: plan.id,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        formattedPrice: plan.getFormattedPrice(),
        appleProductId: plan.appleProductId,
        googleProductId: plan.googleProductId,
      },
    };
  }

  /**
   * Create or update group plan.
   * POST /groups/:id/plan
   */
  @Post(':id/plan')
  @UseGuards(JwtAuthGuard)
  async createGroupPlan(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: CreateGroupPlanDto,
  ) {
    const plan = await this.groupsService.createOrUpdateGroupPlan(
      id,
      req.user.id,
      dto,
    );

    return {
      success: true,
      plan: {
        id: plan.id,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        formattedPrice: plan.getFormattedPrice(),
        stripePriceId: plan.stripePriceId,
      },
    };
  }

  /**
   * Delete group plan (makes group free).
   * DELETE /groups/:id/plan
   */
  @Delete(':id/plan')
  @UseGuards(JwtAuthGuard)
  async deleteGroupPlan(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    await this.groupsService.deleteGroupPlan(id, req.user.id);
    return { success: true };
  }

  // ============================================================================
  // IAP VERIFICATION
  // ============================================================================

  /**
   * Verify IAP purchase.
   * POST /groups/:id/verify-purchase
   */
  @Post(':id/verify-purchase')
  @UseGuards(JwtAuthGuard)
  async verifyPurchase(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: {
      source: PaymentSource;
      receipt?: string;
      purchaseToken?: string;
      productId: string;
    },
  ) {
    let membership;

    switch (body.source) {
      case PaymentSource.APPLE_IAP:
        if (!body.receipt) {
          throw new BadRequestException('Receipt is required for Apple IAP');
        }
        membership = await this.groupsService.verifyApplePurchase(
          id,
          req.user.id,
          body.receipt,
          body.productId,
        );
        break;

      case PaymentSource.GOOGLE_PLAY:
        if (!body.purchaseToken) {
          throw new BadRequestException('Purchase token is required for Google Play');
        }
        membership = await this.groupsService.verifyGooglePurchase(
          id,
          req.user.id,
          body.purchaseToken,
          body.productId,
        );
        break;

      default:
        throw new BadRequestException('Invalid payment source');
    }

    return {
      success: true,
      membership: {
        id: membership.id,
        status: membership.status,
        startedAt: membership.startedAt,
        expiresAt: membership.expiresAt,
      },
    };
  }

  /**
   * Get membership status.
   * GET /groups/:id/membership
   */
  @Get(':id/membership')
  @UseGuards(JwtAuthGuard)
  async getMembership(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    const membership = await this.groupsService.getMembership(id, req.user.id);
    
    if (!membership) {
      return { membership: null };
    }

    return {
      membership: {
        id: membership.id,
        status: membership.status,
        paymentSource: membership.paymentSource,
        startedAt: membership.startedAt,
        expiresAt: membership.expiresAt,
        hasAccess: membership.hasAccess(),
        daysUntilExpiration: membership.getDaysUntilExpiration(),
      },
    };
  }
}

// ============================================================================
// STRIPE CONNECT CONTROLLER
// ============================================================================

@Controller('stripe/connect')
export class StripeConnectController {
  private readonly stripe: Stripe;

  constructor(
    private readonly stripeConnectService: StripeConnectService,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
      { apiVersion: '2024-11-20.acacia' as Stripe.LatestApiVersion },
    );
  }

  /**
   * Get OAuth URL for connecting Stripe account.
   * POST /stripe/connect/authorize
   */
  @Post('authorize')
  @UseGuards(JwtAuthGuard)
  async authorize(@Request() req: AuthRequest) {
    const url = await this.stripeConnectService.getConnectUrl(req.user.id);
    return { url };
  }

  /**
   * OAuth callback from Stripe.
   * GET /stripe/connect/callback
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const baseUrl = this.configService.get<string>('APP_URL') || 'https://railgun.app';

    if (error) {
      return res.redirect(
        `${baseUrl}/settings/payments?error=${encodeURIComponent(errorDescription || error)}`
      );
    }

    try {
      await this.stripeConnectService.handleCallback(code, state);
      return res.redirect(`${baseUrl}/settings/payments?success=true`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect account';
      return res.redirect(
        `${baseUrl}/settings/payments?error=${encodeURIComponent(message)}`
      );
    }
  }

  /**
   * Get account status.
   * GET /stripe/connect/status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Request() req: AuthRequest) {
    return this.stripeConnectService.getAccountStatus(req.user.id);
  }

  /**
   * Get onboarding URL.
   * POST /stripe/connect/onboarding
   */
  @Post('onboarding')
  @UseGuards(JwtAuthGuard)
  async getOnboardingUrl(@Request() req: AuthRequest) {
    const url = await this.stripeConnectService.getOnboardingUrl(req.user.id);
    return { url };
  }

  /**
   * Get dashboard URL.
   * POST /stripe/connect/dashboard
   */
  @Post('dashboard')
  @UseGuards(JwtAuthGuard)
  async getDashboardUrl(@Request() req: AuthRequest) {
    const status = await this.stripeConnectService.getAccountStatus(req.user.id);
    return { url: status.dashboardUrl };
  }

  /**
   * Disconnect Stripe account.
   * DELETE /stripe/connect
   */
  @Delete()
  @UseGuards(JwtAuthGuard)
  async disconnect(@Request() req: AuthRequest) {
    await this.stripeConnectService.disconnectAccount(req.user.id);
    return { success: true };
  }

  /**
   * Stripe Connect webhook.
   * POST /stripe/connect/webhook
   */
  @Post('webhook')
  async webhook(
    @Headers('stripe-signature') signature: string,
    @Request() req: RawBodyRequest<Request>,
  ) {
    const webhookSecret = this.configService.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET');
    
    if (!webhookSecret) {
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody!,
        signature,
        webhookSecret,
      );
    } catch (err) {
      throw new BadRequestException('Invalid webhook signature');
    }

    await this.stripeConnectService.handleWebhook(event);

    return { received: true };
  }
}
