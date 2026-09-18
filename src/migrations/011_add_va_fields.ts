import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.string('va_number', 50);
    t.string('transfer_content', 50);
    t.bigInteger('amount');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('va_number');
    t.dropColumn('transfer_content');
    t.dropColumn('amount');
  });
}