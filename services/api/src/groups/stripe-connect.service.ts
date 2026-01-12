import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { StripeConnectAccountEntity } from './entities/stripe-connect-account.entity';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe: Stripe;

  constructor(
    @InjectRepository(StripeConnectAccountEntity)
    private readonly stripeConnectRepository: Repository<StripeConnectAccountEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || '',
      { apiVersion: '2024-11-20.acacia' as Stripe.LatestApiVersion },
    );
  }

  /**
   * Get the OAuth URL for connecting a Stripe account.
   */
  async getConnectUrl(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const baseUrl = this.configService.get<string>('APP_URL') || 'https://railgun.app';
    const clientId = this.configService.get<string>('STRIPE_CONNECT_CLIENT_ID');

    if (!clientId) {
      throw new BadRequestException('Stripe Connect is not configured');
    }

    // Create state token for security
    const state = Buffer.from(JSON.stringify({
      userId,
      timestamp: Date.now(),
    })).toString('base64');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: `${baseUrl}/api/stripe/connect/callback`,
      state,
      'stripe_user[email]': user.email || '',
    });

    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback from Stripe.
   */
  async handleCallback(code: string, state: string): Promise<StripeConnectAccountEntity> {
    // Decode and validate state
    let stateData: { userId: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch {
      throw new BadRequestException('Invalid state parameter');
    }

    // Check state is not too old (5 minutes)
    if (Date.now() - stateData.timestamp > 5 * 60 * 1000) {
      throw new BadRequestException('Authorization expired, please try again');
    }

    const userId = stateData.userId;

    // Exchange code for access token
    const response = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const stripeAccountId = response.stripe_user_id;
    if (!stripeAccountId) {
      throw new BadRequestException('Failed to connect Stripe account');
    }

    // Get account details
    const account = await this.stripe.accounts.retrieve(stripeAccountId);

    // Create or update our record
    let connectAccount = await this.stripeConnectRepository.findOne({
      where: { userId },
    });

    if (connectAccount) {
      connectAccount.stripeAccountId = stripeAccountId;
      connectAccount.chargesEnabled = account.charges_enabled || false;
      connectAccount.payoutsEnabled = account.payouts_enabled || false;
      connectAccount.onboardingComplete = account.details_submitted || false;
    } else {
      connectAccount = this.stripeConnectRepository.create({
        userId,
        stripeAccountId,
        accountType: 'standard',
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        onboardingComplete: account.details_submitted || false,
      });
    }

    await this.stripeConnectRepository.save(connectAccount);

    this.logger.log(`Connected Stripe account ${stripeAccountId} for user ${userId}`);

    return connectAccount;
  }

  /**
   * Get user's Stripe Connect account status.
   */
  async getAccountStatus(userId: string): Promise<{
    connected: boolean;
    account?: StripeConnectAccountEntity;
    dashboardUrl?: string;
  }> {
    const account = await this.stripeConnectRepository.findOne({
      where: { userId },
    });

    if (!account) {
      return { connected: false };
    }

    // Refresh account status from Stripe
    try {
      const stripeAccount = await this.stripe.accounts.retrieve(account.stripeAccountId);
      
      account.chargesEnabled = stripeAccount.charges_enabled || false;
      account.payoutsEnabled = stripeAccount.payouts_enabled || false;
      account.onboardingComplete = stripeAccount.details_submitted || false;
      
      await this.stripeConnectRepository.save(account);
    } catch (error) {
      this.logger.warn(`Failed to refresh Stripe account status: ${error}`);
    }

    // Get dashboard link
    let dashboardUrl: string | undefined;
    if (account.isReady()) {
      try {
        const loginLink = await this.stripe.accounts.createLoginLink(
          account.stripeAccountId
        );
        dashboardUrl = loginLink.url;
      } catch (error) {
        this.logger.warn(`Failed to create dashboard link: ${error}`);
      }
    }

    return {
      connected: true,
      account,
      dashboardUrl,
    };
  }

  /**
   * Get onboarding URL for incomplete accounts.
   */
  async getOnboardingUrl(userId: string): Promise<string> {
    const account = await this.stripeConnectRepository.findOne({
      where: { userId },
    });

    if (!account) {
      throw new NotFoundException('No Stripe account connected');
    }

    const baseUrl = this.configService.get<string>('APP_URL') || 'https://railgun.app';

    const accountLink = await this.stripe.accountLinks.create({
      account: account.stripeAccountId,
      refresh_url: `${baseUrl}/settings/payments?refresh=true`,
      return_url: `${baseUrl}/settings/payments?success=true`,
      type: 'account_onboarding',
    });

    return accountLink.url;
  }

  /**
   * Disconnect Stripe account.
   */
  async disconnectAccount(userId: string): Promise<void> {
    const account = await this.stripeConnectRepository.findOne({
      where: { userId },
    });

    if (!account) {
      throw new NotFoundException('No Stripe account connected');
    }

    // Revoke access (optional - the account still exists, we just remove our link)
    try {
      const clientId = this.configService.get<string>('STRIPE_CONNECT_CLIENT_ID');
      if (clientId) {
        await this.stripe.oauth.deauthorize({
          client_id: clientId,
          stripe_user_id: account.stripeAccountId,
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to deauthorize Stripe account: ${error}`);
    }

    await this.stripeConnectRepository.remove(account);
    this.logger.log(`Disconnected Stripe account for user ${userId}`);
  }

  /**
   * Handle Stripe Connect webhook events.
   */
  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await this.updateAccountStatus(account);
        break;
      }

      case 'account.application.deauthorized': {
        const application = event.data.object as unknown as { account?: string };
        if (application.account) {
          await this.handleDeauthorization(application.account);
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Connect event type: ${event.type}`);
    }
  }

  private async updateAccountStatus(stripeAccount: Stripe.Account): Promise<void> {
    const account = await this.stripeConnectRepository.findOne({
      where: { stripeAccountId: stripeAccount.id },
    });

    if (!account) {
      this.logger.warn(`No local account found for Stripe account ${stripeAccount.id}`);
      return;
    }

    account.chargesEnabled = stripeAccount.charges_enabled || false;
    account.payoutsEnabled = stripeAccount.payouts_enabled || false;
    account.onboardingComplete = stripeAccount.details_submitted || false;

    await this.stripeConnectRepository.save(account);
    this.logger.log(`Updated status for Stripe account ${stripeAccount.id}`);
  }

  private async handleDeauthorization(stripeAccountId: string): Promise<void> {
    const account = await this.stripeConnectRepository.findOne({
      where: { stripeAccountId },
    });

    if (account) {
      await this.stripeConnectRepository.remove(account);
      this.logger.log(`Removed deauthorized Stripe account ${stripeAccountId}`);
    }
  }
}
