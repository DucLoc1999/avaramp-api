import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('webhook_logs', (t) => {
    t.increments('id');
    t.bigInteger('sepay_transaction_id').notNullable().unique();
    t.jsonb('body').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('webhook_logs');
}
