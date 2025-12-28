import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to create communities, roles, channels, and members tables.
 */
export class CreateCommunities1735234100000 implements MigrationInterface {
  name = 'CreateCommunities1735234100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create communities table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "communities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "description" text,
        "iconUrl" varchar(255),
        "bannerUrl" varchar(255),
        "ownerId" uuid NOT NULL,
        "inviteCode" varchar(16) NOT NULL,
        "isPublic" boolean NOT NULL DEFAULT false,
        "maxMembers" integer NOT NULL DEFAULT 0,
        "memberCount" integer NOT NULL DEFAULT 1,
        "encryptionSettings" jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_communities" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_communities_inviteCode" UNIQUE ("inviteCode"),
        CONSTRAINT "FK_communities_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // Create indexes for communities
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_communities_ownerId" ON "communities" ("ownerId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_communities_inviteCode" ON "communities" ("inviteCode");`);

    // Create roles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "color" varchar(6) NOT NULL DEFAULT '99aab5',
        "communityId" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        "permissions" "permission_enum"[] NOT NULL DEFAULT ARRAY['READ_MESSAGES', 'SEND_MESSAGES']::"permission_enum"[],
        "isHoisted" boolean NOT NULL DEFAULT false,
        "isMentionable" boolean NOT NULL DEFAULT false,
        "isDefault" boolean NOT NULL DEFAULT false,
        "isManaged" boolean NOT NULL DEFAULT false,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_roles_community" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for roles
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_roles_communityId" ON "roles" ("communityId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_roles_communityId_position" ON "roles" ("communityId", "position");`);

    // Create channels table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "topic" text,
        "communityId" uuid NOT NULL,
        "type" "channel_type_enum" NOT NULL DEFAULT 'TEXT',
        "position" integer NOT NULL DEFAULT 0,
        "category" varchar(100),
        "isPrivate" boolean NOT NULL DEFAULT false,
        "isReadOnly" boolean NOT NULL DEFAULT false,
        "rateLimitSeconds" integer NOT NULL DEFAULT 0,
        "isArchived" boolean NOT NULL DEFAULT false,
        "lastMessageAt" timestamp,
        "messageCount" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_channels_community" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create indexes for channels
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_channels_communityId" ON "channels" ("communityId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_channels_communityId_position" ON "channels" ("communityId", "position");`);

    // Create members table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "communityId" uuid NOT NULL,
        "nickname" varchar(100),
        "roleId" uuid,
        "additionalRoleIds" uuid[] NOT NULL DEFAULT '{}',
        "joinedAt" timestamp NOT NULL,
        "isMuted" boolean NOT NULL DEFAULT false,
        "isDeafened" boolean NOT NULL DEFAULT false,
        "muteExpiresAt" timestamp,
        "notificationSettings" jsonb NOT NULL DEFAULT '{"allMessages": true, "mentions": true, "nothing": false}',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_members" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_members_userId_communityId" UNIQUE ("userId", "communityId"),
        CONSTRAINT "FK_members_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_members_community" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_members_role" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    // Create indexes for members
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_members_userId" ON "members" ("userId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_members_communityId" ON "members" ("communityId");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_members_communityId_joinedAt" ON "members" ("communityId", "joinedAt");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop members indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_members_communityId_joinedAt";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_members_communityId";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_members_userId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "members";`);

    // Drop channels indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_channels_communityId_position";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_channels_communityId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "channels";`);

    // Drop roles indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_roles_communityId_position";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_roles_communityId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles";`);

    // Drop communities indexes and table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_communities_inviteCode";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_communities_ownerId";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "communities";`);
  }
}
