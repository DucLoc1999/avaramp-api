const sslEnabled = process.env.DB_SSL !== 'false';

export const databaseConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'avaramp',
  ssl: sslEnabled ? { rejectUnauthorized: false } : (false as const),
  schema: process.env.DB_SCHEMA ?? 'avaramp',
};

export async function testConnection(db: import('knex').Knex): Promise<void> {
  await db.raw('SELECT 1');
}
