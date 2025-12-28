import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial migration to create all core tables and enums.
 * 
 * Creates the following:
 * - UUID extension
 * - Enums for presence, message status, conversation type, device type, channel type, permissions
 * - users table
 * - dm_conversations table
 */
export class CreateUsersAndDMs1735234000000 implements MigrationInterface {
  name = 'CreateUsersAndDMs1735234000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // Create presence_status enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "presence_status_enum" AS ENUM ('ONLINE', 'AWAY', 'DND', 'INVISIBLE', 'OFFLINE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create message_status enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "message_status_enum" AS ENUM ('SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create conversation_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "conversation_type_enum" AS ENUM ('DM', 'CHANNEL');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create device_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "device_type_enum" AS ENUM ('DESKTOP', 'MOBILE', 'WEB');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create channel_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "channel_type_enum" AS ENUM ('TEXT', 'VOICE', 'ANNOUNCEMENT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create permission enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "permission_enum" AS ENUM (
          'MANAGE_COMMUNITY', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_MEMBERS',
          'INVITE_MEMBERS', 'KICK_MEMBERS', 'BAN_MEMBERS',
          'READ_MESSAGES', 'SEND_MESSAGES', 'MANAGE_MESSAGES',
          'ADMINISTRATOR'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username" varchar(32) NOT NULL,
        "displayName" varchar(100) NOT NULL,
        "avatarUrl" varchar(255),
        "email" varchar(255),
        "phone" varchar(20),
        "passwordHash" varchar(255) NOT NULL,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "presence" "presence_status_enum" NOT NULL DEFAULT 'OFFLINE',
        "statusMessage" varchar(255),
        "lastSeenAt" timestamp,
        "refreshTokenHash" varchar(255),
        "recoveryCodes" jsonb DEFAULT '[]',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_username" UNIQUE ("username")
      );
    `);

    // Create indexes for users
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_username" ON "users" ("username");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_email" ON "users" ("email");`);

    // Create dm_conversations table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dm_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" varchar(100) NOT NULL,
        "user1Id" uuid NOT NULL,
        "user2Id" uuid NOT NULL,
        "lastMessageAt" timestamp,
        "lastMessagePreview" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dm_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dm_conversations_conversationId" UNIQUE ("conversationId")
      );
    `);

    // Create indexes for dm_conversations
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dm_conversations_conversationId" ON "dm_conversations" ("conversationId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dm_conversations_user1Id" ON "dm_conversations" ("user1Id");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dm_conversations_user2Id" ON "dm_conversations" ("user2Id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop dm_conversations indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dm_conversations_user2Id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dm_conversations_user1Id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dm_conversations_conversationId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dm_conversations";`);

    // Drop users indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_username";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "permission_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "channel_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "device_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "conversation_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "message_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "presence_status_enum";`);
  }
}
