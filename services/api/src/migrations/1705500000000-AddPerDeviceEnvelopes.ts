import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add per-device message envelopes for multi-device support
 * 
 * This enables Protocol V2 with per-device encrypted envelopes.
 * Each DM message can have multiple envelopes, one for each recipient device.
 */
export class AddPerDeviceEnvelopes1705500000000 implements MigrationInterface {
  name = 'AddPerDeviceEnvelopes1705500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create table for per-device envelopes
    await queryRunner.query(`
      CREATE TABLE "message_envelopes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "messageId" uuid NOT NULL,
        "recipientUserId" uuid NOT NULL,
        "recipientDeviceId" integer NOT NULL,
        "encryptedEnvelope" text NOT NULL,
        "delivered" boolean NOT NULL DEFAULT false,
        "deliveredAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_envelopes" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key to messages table
    await queryRunner.query(`
      ALTER TABLE "message_envelopes"
      ADD CONSTRAINT "FK_message_envelopes_message"
      FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE
    `);

    // Index for efficient lookup by recipient
    await queryRunner.query(`
      CREATE INDEX "IDX_message_envelopes_recipient"
      ON "message_envelopes" ("recipientUserId", "recipientDeviceId", "delivered")
    `);

    // Index for lookup by message
    await queryRunner.query(`
      CREATE INDEX "IDX_message_envelopes_messageId"
      ON "message_envelopes" ("messageId")
    `);

    // Add protocol version column to messages if it doesn't exist
    // (It should exist from the initial migration, but let's be safe)
    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "protocolVersion" smallint NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_envelopes_recipient"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_envelopes_messageId"`);
    
    // Drop foreign key
    await queryRunner.query(`
      ALTER TABLE "message_envelopes"
      DROP CONSTRAINT IF EXISTS "FK_message_envelopes_message"
    `);
    
    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "message_envelopes"`);
  }
}
