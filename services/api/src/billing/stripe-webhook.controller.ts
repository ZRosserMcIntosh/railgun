import {
  Controller,
  Post,
  Headers,
  Req,
  RawBodyRequest,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from './billing.service';

/**
 * StripeWebhookController
 * 
 * Handles Stripe webhook events for subscription lifecycle management.
 * 
 * SECURITY:
 * - Verifies webhook signature using STRIPE_WEBHOOK_SECRET
 * - Uses raw body for signature verification
 * - NO authentication guard (Stripe sends webhooks directly)
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);
  private stripe: Stripe | null = null;
  private webhookSecret: string | null = null;

  constructor(
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (stripeSecretKey) {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2025-12-15.clover',
      });
    }
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || null;
  }

  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!this.stripe || !this.webhookSecret) {
      this.logger.error('Stripe webhook not configured');
      throw new BadRequestException('Webhook not configured');
    }

    if (!signature) {
      this.logger.warn('Webhook received without signature');
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      const rawBody = req.rawBody;
      if (!rawBody) {
        throw new Error('Raw body not available');
      }
      
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Received webhook event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.billingService.handleCheckoutCompleted(
            event.data.object as Stripe.Checkout.Session,
          );
          break;

        case 'customer.subscription.updated':
          await this.billingService.handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'customer.subscription.deleted':
          await this.billingService.handleSubscriptionDeleted(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'invoice.payment_succeeded':
          await this.billingService.handleInvoicePaymentSucceeded(
            event.data.object as Stripe.Invoice,
          );
          break;

        case 'invoice.payment_failed':
          await this.billingService.handleInvoicePaymentFailed(
            event.data.object as Stripe.Invoice,
          );
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(`Error processing webhook event ${event.type}:`, error);
      // Return 200 to acknowledge receipt even if processing fails
      // Stripe will retry failed webhooks
    }

    return { received: true };
  }
}
