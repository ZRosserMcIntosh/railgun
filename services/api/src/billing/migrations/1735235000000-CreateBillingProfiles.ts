import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to create billing_profiles table.
 * 
 * This table stores privacy-preserving billing information that links
 * app users to Stripe using a non-reversible surrogate (billing_ref).
 */
export class CreateBillingProfiles1735235000000 implements MigrationInterface {
  name = 'CreateBillingProfiles1735235000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create subscription_state enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscription_state_enum" AS ENUM (
          'none', 'active', 'trialing', 'past_due', 'canceled', 'paused', 'expired'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create pro_tier enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "pro_tier_enum" AS ENUM ('free', 'pro', 'business');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create billing_profiles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "billingRef" varchar(64) NOT NULL,
        "stripeCustomerId" varchar(64),
        "subscriptionState" "subscription_state_enum" NOT NULL DEFAULT 'none',
        "tier" "pro_tier_enum" NOT NULL DEFAULT 'free',
        "stripeSubscriptionId" varchar(64),
        "currentPeriodEnd" timestamp,
        "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
        "identityVerificationId" varchar(64),
        "identityVerificationStatus" varchar(32),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_profiles_userId" UNIQUE ("userId"),
        CONSTRAINT "UQ_billing_profiles_billingRef" UNIQUE ("billingRef"),
        CONSTRAINT "FK_billing_profiles_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_profiles_userId" ON "billing_profiles" ("userId");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_profiles_stripeCustomerId" 
      ON "billing_profiles" ("stripeCustomerId") 
      WHERE "stripeCustomerId" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_profiles_stripeCustomerId";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_profiles_userId";`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_profiles";`);

    // Drop enums (only if not used elsewhere)
    await queryRunner.query(`DROP TYPE IF EXISTS "pro_tier_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_state_enum";`);
  }
}
