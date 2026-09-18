import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const schemaName = process.env.DB_SCHEMA ?? 'avaramp';
  await knex.raw(`CREATE SCHEMA IF NOT EXISTS ??`, [schemaName]);
}

export async function down(knex: Knex): Promise<void> {
  const schemaName = process.env.DB_SCHEMA ?? 'avaramp';
  await knex.raw(`DROP SCHEMA IF EXISTS ?? CASCADE`, [schemaName]);
}