/**
 * Schema sync script for production deployment
 * Run with: node dist/sync-schema.js
 */
import { DataSource } from 'typeorm';

async function syncSchema() {
  console.log('Starting schema synchronization...');
  console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
  
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    synchronize: false,
    entities: [__dirname + '/**/*.entity.js'],
    logging: ['error', 'warn', 'migration', 'schema'],
  });

  try {
    await dataSource.initialize();
    console.log('Database connected');
    
    // Sync schema (create tables)
    await dataSource.synchronize();
    console.log('Schema synchronized successfully!');
    
    // List tables
    const tables = await dataSource.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    console.log('Tables created:', tables.map((t: any) => t.tablename));
    
    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Error syncing schema:', error);
    process.exit(1);
  }
}

syncSchema();
