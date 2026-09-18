import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('system_wallets', (t) => {
    t.increments('id').primary();
    t.string('name', 50).unique().notNullable();
    t.string('public_key', 56).notNullable();
    t.text('encrypted_secret').notNullable();
    t.string('network', 10).notNullable().defaultTo('testnet');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('system_wallets');
}