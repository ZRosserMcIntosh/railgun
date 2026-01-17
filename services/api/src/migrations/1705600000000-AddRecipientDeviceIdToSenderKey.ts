import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecipientDeviceIdToSenderKey1705600000000
  implements MigrationInterface
{
  name = 'AddRecipientDeviceIdToSenderKey1705600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add recipientDeviceId column with default 0 (meaning all devices)
    await queryRunner.query(`
      ALTER TABLE "sender_key_distribution" 
      ADD COLUMN IF NOT EXISTS "recipientDeviceId" integer NOT NULL DEFAULT 0
    `);

    // Create composite index for efficient lookups by recipient user + device
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sender_key_recipient_device" 
      ON "sender_key_distribution" ("recipientUserId", "recipientDeviceId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_sender_key_recipient_device"
    `);

    await queryRunner.query(`
      ALTER TABLE "sender_key_distribution" 
      DROP COLUMN IF EXISTS "recipientDeviceId"
    `);
  }
}
