import type { Knex } from 'knex';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Knex CLI may change process.cwd() (often to `src/`), so load `.env` from cwd or parent.
for (const candidate of [path.join(process.cwd(), '.env'), path.join(process.cwd(), '..', '.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const sslEnabled = process.env.DB_SSL !== 'false';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'avaramp',
    ssl: sslEnabled ? { rejectUnauthorized: false } : (false as const),
  },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    loadExtensions: ['.ts', '.js'],
  },
  searchPath: [process.env.DB_SCHEMA ?? 'avaramp', 'public'],
};

export default config;
module.exports = config;
