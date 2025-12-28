import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to create Signal protocol key tables.
 * 
 * Creates:
 * - devices: User device registrations
 * - identity_keys: Long-term identity public keys
 * - signed_prekeys: Medium-term signed pre-keys
 * - prekeys: One-time pre-keys
 */
export class CreateCryptoTables1735234300000 implements MigrationInterface {
  name = 'CreateCryptoTables1735234300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create devices table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "deviceId" integer NOT NULL,
        "deviceType" "device_type_enum" NOT NULL DEFAULT 'DESKTOP',
        "deviceName" varchar(100),
        "lastActiveAt" timestamp,
        "pushToken" varchar(255),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_devices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_devices_userId_deviceId" UNIQUE ("userId", "deviceId"),
        CONSTRAINT "FK_devices_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for devices
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_devices_userId" ON "devices" ("userId");`);

    // Create identity_keys table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "identity_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deviceId" uuid NOT NULL,
        "publicKey" text NOT NULL,
        "registrationId" integer NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_identity_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_identity_keys_deviceId" UNIQUE ("deviceId"),
        CONSTRAINT "FK_identity_keys_device" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for identity_keys
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_identity_keys_deviceId" ON "identity_keys" ("deviceId");`);

    // Create signed_prekeys table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "signed_prekeys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deviceId" uuid NOT NULL,
        "keyId" integer NOT NULL,
        "publicKey" text NOT NULL,
        "signature" text NOT NULL,
        "expiresAt" timestamp NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_signed_prekeys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_signed_prekeys_deviceId_keyId" UNIQUE ("deviceId", "keyId"),
        CONSTRAINT "FK_signed_prekeys_device" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for signed_prekeys
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_signed_prekeys_deviceId" ON "signed_prekeys" ("deviceId");`);

    // Create prekeys table (one-time pre-keys)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prekeys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deviceId" uuid NOT NULL,
        "keyId" integer NOT NULL,
        "publicKey" text NOT NULL,
        "isUsed" boolean NOT NULL DEFAULT false,
        "usedAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prekeys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_prekeys_deviceId_keyId" UNIQUE ("deviceId", "keyId"),
        CONSTRAINT "FK_prekeys_device" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for prekeys
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_prekeys_deviceId" ON "prekeys" ("deviceId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_prekeys_deviceId_isUsed" ON "prekeys" ("deviceId", "isUsed");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop prekeys indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prekeys_deviceId_isUsed";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prekeys_deviceId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "prekeys";`);

    // Drop signed_prekeys indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_signed_prekeys_deviceId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "signed_prekeys";`);

    // Drop identity_keys indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_identity_keys_deviceId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_keys";`);

    // Drop devices indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_devices_userId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "devices";`);
  }
}
