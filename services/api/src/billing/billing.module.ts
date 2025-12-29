import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { BillingService } from './billing.service';
import { BillingProfile } from './entities/billing-profile.entity';

/**
 * BillingModule
 * 
 * Handles Pro subscription management with privacy-preserving Stripe integration.
 * Uses pseudonymous billing_ref instead of PII.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BillingProfile]),
  ],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}

