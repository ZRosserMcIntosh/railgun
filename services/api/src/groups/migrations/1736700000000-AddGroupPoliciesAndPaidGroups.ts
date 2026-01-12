import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add group policies and paid groups support.
 * 
 * This migration:
 * 1. Adds policy columns to communities table
 * 2. Creates group_plans table for paid group pricing
 * 3. Creates group_memberships table for tracking paid access
 * 4. Creates stripe_connect_accounts table for owner payouts
 * 5. Creates group_join_requests table for approval flow
 */
export class AddGroupPoliciesAndPaidGroups1736700000000 implements MigrationInterface {
  name = 'AddGroupPoliciesAndPaidGroups1736700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========================================================================
    // ENUMS
    // ========================================================================
    
    await queryRunner.query(`
      CREATE TYPE "join_policy_enum" AS ENUM (
        'OPEN',
        'APPROVAL_REQUIRED',
        'INVITE_ONLY',
        'PAID'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "post_policy_enum" AS ENUM (
        'OPEN',
        'OWNER_ONLY',
        'ROLE_BASED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "group_type_enum" AS ENUM (
        'FULL',
        'BROADCAST',
        'PAID'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "membership_status_enum" AS ENUM (
        'ACTIVE',
        'PAST_DUE',
        'CANCELED',
        'EXPIRED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "payment_source_enum" AS ENUM (
        'STRIPE',
        'APPLE_IAP',
        'GOOGLE_PLAY',
        'PROMO'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "join_request_status_enum" AS ENUM (
        'PENDING',
        'APPROVED',
        'REJECTED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "billing_interval_enum" AS ENUM (
        'ONE_TIME',
        'MONTHLY',
        'YEARLY'
      );
    `);

    // ========================================================================
    // ALTER COMMUNITIES TABLE
    // ========================================================================
    
    // Add handle column (unique, nullable)
    await queryRunner.query(`
      ALTER TABLE "communities" 
      ADD COLUMN "handle" VARCHAR(32) UNIQUE;
    `);

    // Add join policy
    await queryRunner.query(`
      ALTER TABLE "communities" 
      ADD COLUMN "joinPolicy" "join_policy_enum" NOT NULL DEFAULT 'INVITE_ONLY';
    `);

    // Add post policy
    await queryRunner.query(`
      ALTER TABLE "communities" 
      ADD COLUMN "postPolicy" "post_policy_enum" NOT NULL DEFAULT 'OPEN';
    `);

    // Add group type
    await queryRunner.query(`
      ALTER TABLE "communities" 
      ADD COLUMN "groupType" "group_type_enum" NOT NULL DEFAULT 'FULL';
    `);

    // Add discoverable flag
    await queryRunner.query(`
      ALTER TABLE "communities" 
      ADD COLUMN "isDiscoverable" BOOLEAN NOT NULL DEFAULT false;
    `);

    // Create index for handle lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_communities_handle" 
      ON "communities" ("handle") 
      WHERE "handle" IS NOT NULL;
    `);

    // Create index for discoverable groups
    await queryRunner.query(`
      CREATE INDEX "IDX_communities_discoverable" 
      ON "communities" ("isDiscoverable", "isPublic") 
      WHERE "isDiscoverable" = true;
    `);

    // ========================================================================
    // CREATE GROUP_PLANS TABLE
    // ========================================================================
    
    await queryRunner.query(`
      CREATE TABLE "group_plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "communityId" uuid NOT NULL,
        "priceCents" integer NOT NULL,
        "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
        "interval" "billing_interval_enum" NOT NULL,
        "stripeProductId" VARCHAR(255),
        "stripePriceId" VARCHAR(255),
        "appleProductId" VARCHAR(255),
        "googleProductId" VARCHAR(255),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_plans" PRIMARY KEY ("id"),
        CONSTRAINT "FK_group_plans_community" FOREIGN KEY ("communityId") 
          REFERENCES "communities"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_group_plans_community" UNIQUE ("communityId")
      );
    `);

    // ========================================================================
    // CREATE GROUP_MEMBERSHIPS TABLE
    // ========================================================================
    
    await queryRunner.query(`
      CREATE TABLE "group_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "communityId" uuid NOT NULL,
        "groupPlanId" uuid,
        "paymentSource" "payment_source_enum" NOT NULL,
        "externalSubscriptionId" VARCHAR(255),
        "status" "membership_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP,
        "canceledAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "FK_group_memberships_user" FOREIGN KEY ("userId") 
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_group_memberships_community" FOREIGN KEY ("communityId") 
          REFERENCES "communities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_group_memberships_plan" FOREIGN KEY ("groupPlanId") 
          REFERENCES "group_plans"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_group_memberships_user_community" UNIQUE ("userId", "communityId")
      );
    `);

    // Index for looking up memberships by user
    await queryRunner.query(`
      CREATE INDEX "IDX_group_memberships_userId" 
      ON "group_memberships" ("userId");
    `);

    // Index for looking up memberships by community
    await queryRunner.query(`
      CREATE INDEX "IDX_group_memberships_communityId" 
      ON "group_memberships" ("communityId");
    `);

    // Index for expiring subscriptions
    await queryRunner.query(`
      CREATE INDEX "IDX_group_memberships_expiresAt" 
      ON "group_memberships" ("expiresAt") 
      WHERE "expiresAt" IS NOT NULL;
    `);

    // ========================================================================
    // CREATE STRIPE_CONNECT_ACCOUNTS TABLE
    // ========================================================================
    
    await queryRunner.query(`
      CREATE TABLE "stripe_connect_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "stripeAccountId" VARCHAR(255) NOT NULL,
        "accountType" VARCHAR(20) NOT NULL DEFAULT 'standard',
        "chargesEnabled" boolean NOT NULL DEFAULT false,
        "payoutsEnabled" boolean NOT NULL DEFAULT false,
        "onboardingComplete" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stripe_connect_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stripe_connect_accounts_user" FOREIGN KEY ("userId") 
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_stripe_connect_accounts_user" UNIQUE ("userId"),
        CONSTRAINT "UQ_stripe_connect_accounts_stripe" UNIQUE ("stripeAccountId")
      );
    `);

    // ========================================================================
    // CREATE GROUP_JOIN_REQUESTS TABLE
    // ========================================================================
    
    await queryRunner.query(`
      CREATE TABLE "group_join_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "communityId" uuid NOT NULL,
        "status" "join_request_status_enum" NOT NULL DEFAULT 'PENDING',
        "reviewedBy" uuid,
        "reviewedAt" TIMESTAMP,
        "message" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_group_join_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_group_join_requests_user" FOREIGN KEY ("userId") 
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_group_join_requests_community" FOREIGN KEY ("communityId") 
          REFERENCES "communities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_group_join_requests_reviewer" FOREIGN KEY ("reviewedBy") 
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_group_join_requests_user_community" UNIQUE ("userId", "communityId")
      );
    `);

    // Index for pending requests by community
    await queryRunner.query(`
      CREATE INDEX "IDX_group_join_requests_pending" 
      ON "group_join_requests" ("communityId", "status") 
      WHERE "status" = 'PENDING';
    `);

    // ========================================================================
    // ADD POST_MESSAGES PERMISSION
    // ========================================================================
    
    // Add POST_MESSAGES to the permission enum if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "permission_enum" ADD VALUE IF NOT EXISTS 'POST_MESSAGES';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "permission_enum" ADD VALUE IF NOT EXISTS 'APPROVE_MEMBERS';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "permission_enum" ADD VALUE IF NOT EXISTS 'MANAGE_PAYMENTS';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "group_join_requests";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_connect_accounts";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_memberships";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_plans";`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_communities_discoverable";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_communities_handle";`);

    // Remove columns from communities
    await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN IF EXISTS "isDiscoverable";`);
    await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN IF EXISTS "groupType";`);
    await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN IF EXISTS "postPolicy";`);
    await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN IF EXISTS "joinPolicy";`);
    await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN IF EXISTS "handle";`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_interval_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "join_request_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_source_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "membership_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "group_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "post_policy_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "join_policy_enum";`);

    // Note: Cannot remove values from permission_enum easily in PostgreSQL
    // The new permission values will remain but be unused
  }
}
