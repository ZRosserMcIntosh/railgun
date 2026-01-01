import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProTier } from './entities/billing-profile.entity';

/**
 * DTOs
 */
class CreateCheckoutDto {
  tier!: 'pro' | 'business';
  interval!: 'monthly' | 'yearly';
  successUrl!: string;
  cancelUrl!: string;
}

class CreatePortalDto {
  returnUrl!: string;
}

/**
 * BillingController
 * 
 * Handles billing-related HTTP endpoints.
 * All endpoints require authentication.
 */
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Get current subscription status
   */
  @Get('status')
  async getStatus(@Request() req: { user: { userId: string } }) {
    const status = await this.billingService.getSubscriptionStatus(req.user.userId);
    return {
      tier: status.tier,
      state: status.state,
      currentPeriodEnd: status.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: status.cancelAtPeriodEnd,
      hasProAccess: await this.billingService.hasProAccess(req.user.userId),
    };
  }

  /**
   * Check if user has Pro access (quick check)
   */
  @Get('has-pro')
  async hasPro(@Request() req: { user: { userId: string } }) {
    return {
      hasPro: await this.billingService.hasProAccess(req.user.userId),
    };
  }

  /**
   * Create a Stripe Checkout session
   */
  @Post('checkout')
  async createCheckout(
    @Request() req: { user: { userId: string } },
    @Body() body: CreateCheckoutDto,
  ) {
    // Validate tier
    let tier: ProTier;
    switch (body.tier) {
      case 'pro':
        tier = ProTier.PRO;
        break;
      case 'business':
        tier = ProTier.BUSINESS;
        break;
      default:
        throw new BadRequestException('Invalid tier');
    }

    // Validate interval
    if (body.interval !== 'monthly' && body.interval !== 'yearly') {
      throw new BadRequestException('Invalid interval');
    }

    // Validate URLs
    if (!body.successUrl || !body.cancelUrl) {
      throw new BadRequestException('successUrl and cancelUrl are required');
    }

    const session = await this.billingService.createCheckoutSession(
      req.user.userId,
      tier,
      body.interval,
      body.successUrl,
      body.cancelUrl,
    );

    return session;
  }

  /**
   * Create a Stripe Customer Portal session
   */
  @Post('portal')
  async createPortal(
    @Request() req: { user: { userId: string } },
    @Body() body: CreatePortalDto,
  ) {
    if (!body.returnUrl) {
      throw new BadRequestException('returnUrl is required');
    }

    const session = await this.billingService.createPortalSession(
      req.user.userId,
      body.returnUrl,
    );

    return session;
  }

  /**
   * Get ephemeral key for mobile SDK (Stripe PaymentSheet)
   */
  @Get('ephemeral-key')
  async getEphemeralKey(
    @Request() req: { user: { userId: string } },
    @Query('apiVersion') apiVersion: string,
  ) {
    if (!apiVersion) {
      throw new BadRequestException('apiVersion query param is required');
    }

    return this.billingService.getEphemeralKey(req.user.userId, apiVersion);
  }
}
