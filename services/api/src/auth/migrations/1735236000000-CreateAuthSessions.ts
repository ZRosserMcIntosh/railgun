import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAuthSessions1735236000000 implements MigrationInterface {
  name = 'CreateAuthSessions1735236000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for session status
    await queryRunner.query(`
      CREATE TYPE auth_session_status AS ENUM (
        'pending',
        'scanned',
        'completed',
        'expired',
        'cancelled'
      )
    `);

    // Create auth_sessions table
    await queryRunner.createTable(
      new Table({
        name: 'auth_sessions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'secret',
            type: 'varchar',
            length: '64',
          },
          {
            name: 'status',
            type: 'auth_session_status',
            default: "'pending'",
          },
          {
            name: 'userId',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'userPublicKey',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'clientType',
            type: 'varchar',
            length: '20',
            default: "'web'",
          },
          {
            name: 'creatorIp',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'creatorUserAgent',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'completerIp',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'expiresAt',
            type: 'timestamp',
          },
          {
            name: 'completedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'auth_sessions',
      new TableIndex({
        name: 'IDX_auth_sessions_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'auth_sessions',
      new TableIndex({
        name: 'IDX_auth_sessions_expiresAt',
        columnNames: ['expiresAt'],
      }),
    );

    await queryRunner.createIndex(
      'auth_sessions',
      new TableIndex({
        name: 'IDX_auth_sessions_status_expiresAt',
        columnNames: ['status', 'expiresAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('auth_sessions', 'IDX_auth_sessions_status_expiresAt');
    await queryRunner.dropIndex('auth_sessions', 'IDX_auth_sessions_expiresAt');
    await queryRunner.dropIndex('auth_sessions', 'IDX_auth_sessions_status');

    // Drop table
    await queryRunner.dropTable('auth_sessions');

    // Drop enum type
    await queryRunner.query('DROP TYPE auth_session_status');
  }
}
