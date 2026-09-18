import Knex from 'knex';
import path from 'path';
import fs from 'fs';
import { databaseConfig } from './config/database';

const isTestEnv = process.env.NODE_ENV === 'test';

const sslEnabled = !isTestEnv && process.env.DB_SSL !== 'false';

const migrationSource = {
  getMigrations(): Promise<string[]> {
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir)
      .filter(f => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts'))
      .sort()
      .map(f => f.replace(/\.(js|ts)$/, '.ts'));
    return Promise.resolve([...new Set(files)]);
  },
  getMigrationName(migration: string): string {
    return migration;
  },
  async getMigration(migration: string): Promise<{ up: (knex: Knex.Knex) => Promise<void>; down: (knex: Knex.Knex) => Promise<void> }> {
    const base = migration.replace(/\.ts$/, '');
    const jsFile = path.join(__dirname, 'migrations', base + '.js');
    const tsFile = path.join(__dirname, 'migrations', base + '.ts');
    const filePath = fs.existsSync(jsFile) ? jsFile : tsFile;
    const mod = await import(filePath);
    return mod;
  },
};

type KnexConfig = Parameters<typeof Knex>[0];

const dbConfig: KnexConfig = isTestEnv
  ? {
      client: 'sqlite3',
      connection: {
        filename: ':memory:',
      },
      useNullAsDefault: true,
      migrations: { migrationSource },
    }
  : {
      client: 'pg',
      connection: {
        host: databaseConfig.host,
        port: databaseConfig.port,
        user: databaseConfig.user,
        password: databaseConfig.password,
        database: databaseConfig.database,
        ssl: databaseConfig.ssl,
      },
      pool: { min: 2, max: 10 },
      searchPath: [databaseConfig.schema, 'public'],
      migrations: { migrationSource },
    };

const db = Knex(dbConfig);

export default db;