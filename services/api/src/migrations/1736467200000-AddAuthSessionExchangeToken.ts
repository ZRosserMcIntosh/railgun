import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add exchange token security to auth sessions.
 * 
 * Security Enhancement (2026-01-09):
 * Adds one-time exchange token mechanism to QR auth flow to prevent
 * replay attacks and unauthorized token minting.
 * 
 * Changes:
 * - Add exchange_token column (nullable, varchar 64)
 * - Add is_exchanged column (boolean, default false)
 * 
 * These columns enable one-time JWT exchange after QR auth completion,
 * preventing session hijacking if sessionId leaks.
 */
export class AddAuthSessionExchangeToken1736467200000 implements MigrationInterface {
  name = 'AddAuthSessionExchangeToken1736467200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add exchange_token column
    await queryRunner.query(`
      ALTER TABLE "auth_sessions" 
      ADD COLUMN "exchange_token" VARCHAR(64);
    `);

    // Add is_exchanged column with default false
    await queryRunner.query(`
      ALTER TABLE "auth_sessions" 
      ADD COLUMN "is_exchanged" BOOLEAN NOT NULL DEFAULT false;
    `);

    // Add index on exchange_token for fast lookup (sparse index - only non-null values)
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_sessions_exchange_token" 
      ON "auth_sessions" ("exchange_token") 
      WHERE "exchange_token" IS NOT NULL;
    `);

    // Add index on is_exchanged for cleanup queries
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_sessions_is_exchanged" 
      ON "auth_sessions" ("is_exchanged");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_auth_sessions_is_exchanged";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_auth_sessions_exchange_token";
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "auth_sessions" 
      DROP COLUMN IF EXISTS "is_exchanged";
    `);

    await queryRunner.query(`
      ALTER TABLE "auth_sessions" 
      DROP COLUMN IF EXISTS "exchange_token";
    `);
  }
}
