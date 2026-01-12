import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateGroupInvites1736668800000 implements MigrationInterface {
  name = 'CreateGroupInvites1736668800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create group_invites table
    await queryRunner.createTable(
      new Table({
        name: 'group_invites',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'communityId',
            type: 'uuid',
          },
          {
            name: 'createdById',
            type: 'uuid',
          },
          {
            name: 'tokenHash',
            type: 'varchar',
            length: '64',
            comment: 'SHA256 hash of the invite token - never store raw token',
          },
          {
            name: 'roleId',
            type: 'uuid',
            isNullable: true,
            comment: 'Role to assign on join, null for default role',
          },
          {
            name: 'maxUses',
            type: 'int',
            default: 1,
            comment: 'Maximum number of uses, 0 for unlimited',
          },
          {
            name: 'uses',
            type: 'int',
            default: 0,
            comment: 'Current number of uses',
          },
          {
            name: 'expiresAt',
            type: 'timestamp with time zone',
            comment: 'When this invite expires',
          },
          {
            name: 'revoked',
            type: 'boolean',
            default: false,
            comment: 'Whether this invite has been manually revoked',
          },
          {
            name: 'revokedAt',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'revokedById',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
            comment: 'Optional metadata like channel restrictions',
          },
          {
            name: 'createdAt',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'group_invites',
      new TableIndex({
        name: 'IDX_group_invites_communityId',
        columnNames: ['communityId'],
      }),
    );

    await queryRunner.createIndex(
      'group_invites',
      new TableIndex({
        name: 'IDX_group_invites_tokenHash',
        columnNames: ['tokenHash'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'group_invites',
      new TableIndex({
        name: 'IDX_group_invites_createdById',
        columnNames: ['createdById'],
      }),
    );

    await queryRunner.createIndex(
      'group_invites',
      new TableIndex({
        name: 'IDX_group_invites_expiresAt',
        columnNames: ['expiresAt'],
      }),
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'group_invites',
      new TableForeignKey({
        columnNames: ['communityId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'communities',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'group_invites',
      new TableForeignKey({
        columnNames: ['createdById'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'group_invites',
      new TableForeignKey({
        columnNames: ['roleId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'roles',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'group_invites',
      new TableForeignKey({
        columnNames: ['revokedById'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    // Create invite_usage_logs table for audit
    await queryRunner.createTable(
      new Table({
        name: 'invite_usage_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'inviteId',
            type: 'uuid',
          },
          {
            name: 'userId',
            type: 'uuid',
          },
          {
            name: 'ip',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'userAgent',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'success',
            type: 'boolean',
          },
          {
            name: 'failureReason',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'invite_usage_logs',
      new TableIndex({
        name: 'IDX_invite_usage_logs_inviteId',
        columnNames: ['inviteId'],
      }),
    );

    await queryRunner.createIndex(
      'invite_usage_logs',
      new TableIndex({
        name: 'IDX_invite_usage_logs_userId',
        columnNames: ['userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('invite_usage_logs', true);
    await queryRunner.dropTable('group_invites', true);
  }
}
