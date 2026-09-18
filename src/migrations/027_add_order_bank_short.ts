import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.string('bank_short', 50);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('bank_short');
  });
}
