import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.timestamp('cancelled_at');
    t.string('cancel_reason', 500);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('cancelled_at');
    t.dropColumn('cancel_reason');
  });
}