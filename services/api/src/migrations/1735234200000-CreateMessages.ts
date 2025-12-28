import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to create messages table.
 */
export class CreateMessages1735234200000 implements MigrationInterface {
  name = 'CreateMessages1735234200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create messages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "senderId" uuid NOT NULL,
        "channelId" uuid,
        "conversationId" varchar(73),
        "conversationType" "conversation_type_enum" NOT NULL DEFAULT 'CHANNEL',
        "encryptedEnvelope" text NOT NULL,
        "protocolVersion" smallint NOT NULL DEFAULT 1,
        "clientNonce" varchar(36) NOT NULL,
        "status" "message_status_enum" NOT NULL DEFAULT 'SENT',
        "deliveredAt" timestamp,
        "readAt" timestamp,
        "replyToId" uuid,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "isEdited" boolean NOT NULL DEFAULT false,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_messages_sender" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_messages_channel" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_messages_replyTo" FOREIGN KEY ("replyToId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    // Create indexes for messages
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_senderId" ON "messages" ("senderId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_channelId" ON "messages" ("channelId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_conversationId" ON "messages" ("conversationId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_clientNonce" ON "messages" ("clientNonce");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_channelId_createdAt" ON "messages" ("channelId", "createdAt");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_senderId_createdAt" ON "messages" ("senderId", "createdAt");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop messages indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_senderId_createdAt";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_channelId_createdAt";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_clientNonce";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_conversationId";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_channelId";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_senderId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages";`);
  }
}
