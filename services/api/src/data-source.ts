import { DataSource, DataSourceOptions } from 'typeorm';
import * as migrations from './migrations';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

/**
 * TypeORM Data Source Configuration
 * 
 * Used by TypeORM CLI for migrations. Supports:
 * - DATABASE_URL (Supabase/production)
 * - Individual connection params (local dev)
 * 
 * Usage:
 *   pnpm migration:generate src/migrations/MyMigration
 *   pnpm migration:run
 *   pnpm migration:revert
 */

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

// Base configuration
const baseConfig: Partial<DataSourceOptions> = {
  type: 'postgres',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  // Use explicit migrations from index to avoid duplicates
  migrations: Object.values(migrations),
  migrationsTableName: 'typeorm_migrations',
  logging: isProduction ? ['error', 'migration'] : ['error', 'warn', 'migration'],
};

// SSL config for cloud databases
const sslConfig = databaseUrl ? {
  ssl: { rejectUnauthorized: false },
} : {};

// Build final config
const config: DataSourceOptions = databaseUrl
  ? {
      ...baseConfig,
      url: databaseUrl,
      extra: sslConfig,
    } as DataSourceOptions
  : {
      ...baseConfig,
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_USER || 'railgun',
      password: process.env.DATABASE_PASSWORD || 'railgun_dev_password',
      database: process.env.DATABASE_NAME || 'railgun',
    } as DataSourceOptions;

// Export DataSource for CLI (single export required by TypeORM CLI)
const AppDataSource = new DataSource(config);

export default AppDataSource;
